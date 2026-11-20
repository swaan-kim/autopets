import { useRef, useState } from 'react';
import { command, isDesktop } from '../../bridge/command';

type Update = { status: 'disabled' | 'current' | 'available'; version?: string; message?: string };
export function AppUpdate() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const working = useRef(false);
  const run = async (install = false) => {
    if (!isDesktop || working.current || (install && (!update?.version || update.status !== 'available'))) return;
    working.current = true; setBusy(true); setMessage('');
    if (!install) setUpdate(null);
    try {
      if (install) { await command('install_app_update', { version: update!.version }); setUpdate(null); setMessage('업데이트 설치를 시작했어요.'); }
      // The disabled state always uses the plain sentence here; other states keep the app's own message.
      else { const result = await command<Update>('check_app_update'); setUpdate(result); setMessage(result.status === 'disabled' ? '이 버전은 자동 업데이트를 지원하지 않아요.' : result.message || (result.status === 'current' ? '최신 버전이에요.' : `${result.version} 업데이트를 설치할 수 있어요.`)); }
    } catch { setMessage(install ? '업데이트를 설치하지 못했어요. 업데이트 확인을 다시 눌러 주세요.' : '업데이트를 확인하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.'); }
    finally { working.current = false; setBusy(false); }
  };
  return <details className="setup-update"><summary>앱 업데이트 확인</summary><button className="button secondary" disabled={!isDesktop || busy} onClick={() => void run()}>업데이트 확인</button>{update?.status === 'available' && update.version && <button className="button primary" disabled={busy} onClick={() => void run(true)}>{update.version} 설치하기</button>}{message && <p role="status">{message}</p>}</details>;
}
