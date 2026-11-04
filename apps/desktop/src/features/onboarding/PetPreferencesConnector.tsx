import { useRef, useState } from 'react';
import { command, isDesktop } from '../../bridge/command';

export function PetPreferencesConnector({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(false);
  const save = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setFileName('');
    try {
      const name = await command<string>('export_pet_preferences');
      if (typeof name !== 'string' || !/^AutoPets-pet-preferences-[0-9a-f-]{36}\.mcpb$/.test(name)) throw Error('unconfirmed-export');
      setFileName(name);
    } catch { setError('연결 파일을 저장하지 못했어요. 다운로드 폴더에 저장할 수 있는지 확인해 주세요.'); }
    finally { pending.current = false; setBusy(false); }
  };
  if (compact) return <div className="composer-claude-connector">
    {isDesktop ? <button className="button secondary" disabled={busy} onClick={() => void save()}>{busy ? '저장 중…' : 'Claude 연결 파일'}<span aria-hidden="true">↓</span></button>
      : <a className="button secondary" href="/assets/connectors/AutoPets-pet-preferences.mcpb" download="AutoPets-pet-preferences.mcpb">Claude 연결 파일<span aria-hidden="true">↓</span></a>}
    {fileName && <p className="setup-notice" role="status">다운로드/AutoPets에 저장했어요.<br />Claude 설정 → 확장 프로그램 → 고급 설정에서 설치하세요.</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
  return <details className="connection-preset-share"><summary>다른 AI에서도 펫 설정 쓰기</summary>
    <h2>저장한 작업 방식을 그대로 가져가요.</h2>
    <p>Claude의 로컬 확장에 연결 도구를 추가하면, 사용자가 고른 펫의 지침을 읽는 경로를 준비할 수 있어요.</p>
    <ol><li>이 앱에서 원하는 펫 구성을 저장해요.</li><li>확장 파일을 받고 Claude의 확장 설정에서 설치해요.</li><li>쓰던 대화에서 “AutoPets에 저장한 펫 찾아줘”라고 말해요.</li></ol>
    {isDesktop ? <button className="button secondary" disabled={busy} onClick={() => void save()}>{busy ? '파일 저장 중…' : 'Claude용 연결 파일 받기'}</button>
      : <a className="button secondary" href="/assets/connectors/AutoPets-pet-preferences.mcpb" download="AutoPets-pet-preferences.mcpb">Claude용 연결 파일 받기</a>}
    {fileName && <p className="setup-notice" role="status">다운로드 폴더의 AutoPets에 저장했어요. Claude의 확장 설정에서 이 파일을 선택해 주세요.<br /><code>{fileName}</code></p>}
    {error && <p className="error" role="alert">{error}</p>}
    <p className="small-note">연결 준비판 · 실제 Claude 설치·활용 검증 전이에요. 펫 설정 읽기만 준비하며, 대화 공유·스킬 실행·모델 변경은 확인하지 않았어요. ChatGPT 웹·Work의 클라우드 연결은 별도예요.</p>
  </details>;
}
