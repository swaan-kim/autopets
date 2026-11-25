import { useEffect, useState } from 'react';
import { command, isDesktop } from '../../bridge/command';
import './pet-settings.css';

// "컴퓨터를 켤 때 · 펫 띄우기" (platform/autostart.rs): a Windows sign-in entry that starts AutoPets
// with only the pets that were out last time and the tray icon. Off by default; asked once.
export type AutostartState = { enabled: boolean; asked: boolean };
const CHANGED = 'autopets-autostart-changed';

export function useAutostart() {
  const [state, setState] = useState<AutostartState | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!isDesktop) return;
    const load = () => void command<AutostartState>('autostart_state').then(setState).catch(() => setError('시작 프로그램 설정을 읽지 못했어요.'));
    load();
    window.addEventListener(CHANGED, load);
    return () => window.removeEventListener(CHANGED, load);
  }, []);
  const run = async (name: 'set_autostart' | 'dismiss_autostart_prompt', args?: Record<string, unknown>) => {
    try {
      setState(await command<AutostartState>(name, args)); setError('');
      window.dispatchEvent(new Event(CHANGED));
      return true;
    } catch { setError('시작 프로그램 설정을 바꾸지 못했어요.'); return false; }
  };
  return { state, error, set: (enabled: boolean) => run('set_autostart', { enabled }), dismiss: () => run('dismiss_autostart_prompt') };
}

/** Asked once, the first time the app opens with this feature: "띄우기" turns it on, "나중에" keeps it off. */
export function AutostartPrompt() {
  const { state, error, set, dismiss } = useAutostart();
  const [busy, setBusy] = useState(false);
  if (!state || state.asked) return null;
  const answer = async (on: boolean) => { setBusy(true); await (on ? set(true) : dismiss()); setBusy(false); };
  return <section className="autostart-prompt" role="dialog" aria-label="컴퓨터를 켤 때" data-agent-id="settings.autostart-prompt">
    <p><strong>컴퓨터를 켜면 펫을 띄울까요?</strong><small>마지막에 쓰던 펫이 바로 떠요. 설정 → 펫 설정에서 바꿀 수 있어요.</small></p>
    <div>
      <button type="button" className="button primary" disabled={busy} onClick={() => void answer(true)}>띄우기</button>
      <button type="button" className="text-button" disabled={busy} onClick={() => void answer(false)}>나중에</button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
