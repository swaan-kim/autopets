import { useState } from 'react';
import hubData from '../../../../../packages/contracts/data/skill-hub.json';
import { command, isDesktop } from '../../bridge/command';
import './skill-hub.css';

// The skill hub: capabilities that already exist in AI tools (built-in features, official skills,
// plugins and connectors), explained in plain words with one click to try them. Nothing here is
// made up by AutoPets, and nothing is copied or pasted by the user: the app opens an official
// address, or opens the AI with a short request filled in for the user to send.
type HubStart = { target: string; label: string; url?: string; prompt?: string };
type HubEntry = { id: string; kind: string; name: string; publisher: string; worksIn: string[]; summary: string; when: string; needs: string; note: string; source: string; starts: HubStart[] };
const hub = hubData as unknown as { verifiedAt: string; kinds: Record<string, string>; entries: HubEntry[] };
const HOSTS: Record<string, string> = { chatgpt: 'ChatGPT', codex: 'Codex', claude: 'Claude', 'claude-code': 'Claude Code' };

export function SkillHub() {
  const [kind, setKind] = useState('all');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const entries = hub.entries.filter(entry => kind === 'all' || entry.kind === kind);
  // The app receives only the entry id and the target; it takes the address or prompt from its own list.
  const start = async (entry: HubEntry, target: string, address?: string) => {
    if (busy) return;
    setBusy(`${entry.id}:${target}`); setNotice(null);
    try {
      if (isDesktop) {
        await command('start_hub_entry', { id: entry.id, target });
        setNotice({ id: entry.id, text: address ? '브라우저에서 열었어요.' : '요청을 넣어 열었어요. 보내기만 누르세요.' });
      } else if (address) window.open(address, '_blank', 'noopener,noreferrer');
      else setNotice({ id: entry.id, text: '설치 앱에서 열 수 있어요.' });
    } catch { setNotice({ id: entry.id, text: '열지 못했어요. 해당 앱이 설치돼 있는지 확인해 주세요.' }); }
    finally { setBusy(''); }
  };
  return <section className="skill-hub" aria-label="이미 있는 기능과 스킬" data-agent-id="pet-selection.hub">
    <header><h2>이미 있는 기능과 스킬</h2><p>AI 툴에 원래 있거나 공식으로 제공되는 것들이에요. 무엇인지 보고 바로 써 보세요.</p></header>
    <div className="skill-hub-kinds" role="group" aria-label="종류">
      {[['all', '모두'], ...Object.entries(hub.kinds)].map(([id, label]) => <button key={id} aria-pressed={kind === id} onClick={() => { setKind(id); setOpen(null); }}>{label}</button>)}
    </div>
    <ul className="skill-hub-list">{entries.map(entry => <li key={entry.id} data-kind={entry.kind} data-hub-entry={entry.id}>
      <button className="skill-hub-row" aria-expanded={open === entry.id} onClick={() => { setOpen(open === entry.id ? null : entry.id); setNotice(null); }}>
        <span className="skill-hub-kind">{hub.kinds[entry.kind]}</span>
        <strong>{entry.name}</strong>
        <span className="skill-hub-summary">{entry.summary}</span>
      </button>
      {open === entry.id && <div className="skill-hub-detail">
        <dl>
          <dt>언제 쓰나요</dt><dd>{entry.when}</dd>
          <dt>필요한 것</dt><dd>{entry.needs}</dd>
          <dt>쓸 수 있는 곳</dt><dd>{entry.worksIn.map(host => HOSTS[host] ?? host).join(' · ')}</dd>
        </dl>
        {entry.note && <p className="skill-hub-note">{entry.note}</p>}
        <div className="skill-hub-actions">
          {entry.starts.map(item => <button key={item.target} className="button primary" disabled={Boolean(busy)} onClick={() => void start(entry, item.target, item.url)}>{item.label}<span aria-hidden="true"> ↗</span></button>)}
          <button className="text-button" disabled={Boolean(busy)} onClick={() => void start(entry, 'source', entry.source)}>{entry.publisher} 공식 설명 ↗</button>
        </div>
        {notice?.id === entry.id && <p className="skill-hub-notice" role="status">{notice.text}</p>}
      </div>}
    </li>)}</ul>
    <small className="skill-hub-checked">{hub.verifiedAt} 기준으로 각 공식 설명과 대조했어요. 요금제와 메뉴는 바뀔 수 있어요.</small>
  </section>;
}
