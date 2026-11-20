import { useRef, useState } from 'react';
import type { SavedPet } from '@autopets/contracts/types';
import { command, isDesktop } from '../../bridge/command';

export type ClaudeAction = 'install' | 'use';

// Claude's own install window and a prefilled new chat replace the manual file
// and copy-paste steps. Claude still asks the user to confirm the install and to
// send the message; AutoPets never claims either happened.
// Shared with the pet start button. Resolves to the notice to show; rejects with a readable message.
export async function runClaudeAction(action: ClaudeAction, pet: SavedPet | null) {
  try {
    if (action === 'install') {
      const name = await command<string>('install_pet_preferences_in_claude');
      if (typeof name !== 'string' || !/^AutoPets-pet-preferences-[0-9a-f-]{36}\.mcpb$/.test(name)) throw Error('unconfirmed-export');
      return 'Claude 설치 창에서 설치를 눌러 주세요. 이미 설치했다면 닫아도 돼요.';
    }
    if (!pet) return '';
    await command('open_pet_in_claude', { petId: pet.id, expectedRevision: pet.revision });
    return 'Claude 새 채팅에 요청을 넣었어요. 모델을 고르고 보내기만 눌러 주세요.';
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
    throw Error(/[가-힣]/.test(message) ? message : action === 'install' ? 'Claude 설치 창을 열지 못했어요. Claude 데스크톱 앱이 설치돼 있는지 확인해 주세요.' : 'Claude 앱을 열지 못했어요. Claude 데스크톱 앱이 설치돼 있는지 확인해 주세요.');
  }
}

export function PetPreferencesConnector({ compact = false, pet = null }: { compact?: boolean; pet?: SavedPet | null }) {
  const [busy, setBusy] = useState<ClaudeAction | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(false);
  const act = async (action: ClaudeAction) => {
    if (pending.current) return;
    pending.current = true; setBusy(action); setError(''); setNotice('');
    try { setNotice(await runClaudeAction(action, pet)); }
    catch (cause) { setError((cause as Error).message); }
    finally { pending.current = false; setBusy(null); }
  };
  const install = isDesktop
    ? <button className="button secondary" disabled={busy !== null} onClick={() => void act('install')}>{busy === 'install' ? '여는 중…' : 'Claude에 설치'}</button>
    : <a className="button secondary" href="/assets/connectors/AutoPets-pet-preferences.mcpb" download="AutoPets-pet-preferences.mcpb">Claude 연결 파일 받기</a>;
  const use = isDesktop && pet
    ? <button className="button secondary" disabled={busy !== null} onClick={() => void act('use')}>{busy === 'use' ? '여는 중…' : 'Claude에서 쓰기'}<span aria-hidden="true">↗</span></button>
    : null;
  const status = <>
    {notice && <p className="setup-notice" role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </>;
  if (compact) return <div className="composer-claude-connector">{use}{install}{status}</div>;
  return <details className="connection-preset-share"><summary>Claude · Claude Code에서 쓰기</summary>
    <h2>Claude</h2>
    <p>저장한 펫을 Claude 앱에서도 쓸 수 있어요.</p>
    <ol><li><strong>Claude에 설치</strong>를 누르고 Claude 창에서 설치를 확인해 주세요. 한 번만 하면 돼요.</li><li>펫 화면에서 <strong>Claude에서 쓰기</strong>를 누르면 요청이 적힌 새 채팅이 열려요. 거기서 보내기만 눌러 주세요.</li></ol>
    {install}
    {status}
    <p className="small-note">Claude는 저장한 펫 설정만 읽어요. 채팅 내용은 AutoPets로 오지 않아요.</p>
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
      setNotice(action === 'connect' ? '연결했어요. 다음에 새로 시작하는 Claude Code 작업부터 펫이 움직여요.' : '연결을 해제했어요.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
      setError(/[가-힣]/.test(message) ? message : 'Claude Code 연결을 바꾸지 못했어요. 다시 시도해 주세요.');
    } finally { pending.current = false; setBusy(null); }
  };
  return <section className="claude-code-connector" aria-label="Claude Code 연결">
    <h2>Claude Code</h2>
    <p>Claude Code로 일할 때도 펫이 움직여요. 작업 시작·도구 사용·권한 요청·완료 상태만 펫에 전하고, 채팅 내용과 파일 내용은 보내지 않아요.</p>
    <div className="claude-code-actions">
      <button className="button secondary" disabled={busy !== null} onClick={() => void act('connect')}>{busy === 'connect' ? '연결 중…' : 'Claude Code에 연결'}</button>
      <button className="text-button" disabled={busy !== null} onClick={() => void act('disconnect')}>{busy === 'disconnect' ? '해제 중…' : 'Claude Code 연결 해제'}</button>
    </div>
    {notice && <p className="setup-notice" role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
