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
      if (install) { await command('install_app_update', { version: update!.version }); setUpdate(null); setMessage('업데이트 설치를 요청했어요.'); }
      else { const result = await command<Update>('check_app_update'); setUpdate(result); setMessage(result.message || (result.status === 'disabled' ? '이 빌드에서는 공개 업데이트를 제공하지 않아요.' : result.status === 'current' ? '최신 버전이에요.' : `${result.version} 업데이트를 설치할 수 있어요.`)); }
    } catch { setMessage('업데이트를 처리하지 못했어요. 잠시 후 다시 확인해주세요.'); }
    finally { working.current = false; setBusy(false); }
  };
  return <details className="setup-update"><summary>앱 업데이트</summary><button className="button secondary" disabled={!isDesktop || busy} onClick={() => void run()}>업데이트 확인</button>{update?.status === 'available' && update.version && <button className="button primary" disabled={busy} onClick={() => void run(true)}>{update.version} 설치하기</button>}{message && <p role="status">{message}</p>}</details>;
}
