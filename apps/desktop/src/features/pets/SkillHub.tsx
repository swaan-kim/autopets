import { useRef, useState } from 'react';
import hubData from '../../../../../packages/contracts/data/skill-hub.json';
import { command, isDesktop } from '../../bridge/command';
import './skill-hub.css';

type HubStart = { target: string; label: string; url?: string; prompt?: string };
type HubEntry = { id: string; publisher: string; needs: string; note: string; source: string; starts: HubStart[] };
type Group = 'all' | 'documents' | 'learning' | 'connected';
type Tool = { id: string; group: Exclude<Group, 'all'>; name: string; summary: string; host: string; icon: string };
const hub = hubData as unknown as { verifiedAt: string; entries: HubEntry[] };
// Presentation only. Keep the shared catalog and its allowlisted launch targets intact.
// Prefer concrete jobs; plugin setup and duplicate project features do not need a place here.
const tools: Tool[] = [
  { id: 'anthropic-pptx', group: 'documents', name: '발표자료', summary: '편집할 수 있는 PowerPoint 파일.', host: 'Claude', icon: 'slides' },
  { id: 'anthropic-docx', group: 'documents', name: '문서 작성', summary: '보고서와 초안을 Word 파일로.', host: 'Claude', icon: 'document' },
  { id: 'anthropic-xlsx', group: 'documents', name: '표·계산', summary: '수식이 있는 Excel 표 만들기.', host: 'Claude', icon: 'table' },
  { id: 'anthropic-pdf', group: 'documents', name: 'PDF 정리', summary: '글과 표를 꺼내거나 PDF 만들기.', host: 'Claude', icon: 'pdf' },
  { id: 'chatgpt-deep-research', group: 'learning', name: '자료 조사', summary: '여러 자료를 출처와 함께 조사해요.', host: 'ChatGPT', icon: 'search' },
  { id: 'chatgpt-study-mode', group: 'learning', name: '개념 공부', summary: '질문을 주고받으며 이해해요.', host: 'ChatGPT', icon: 'study' },
  { id: 'connector-google-workspace', group: 'connected', name: '메일·일정·파일', summary: 'Google에 있는 내 자료 찾기.', host: 'Claude · Google', icon: 'mail' },
  { id: 'connector-notion', group: 'connected', name: 'Notion 문서', summary: '페이지를 찾아 읽고 정리해요.', host: 'Claude · Notion', icon: 'notebook' },
];
const groups: [Group, string][] = [['all', '추천'], ['documents', '문서·표'], ['learning', '조사·학습'], ['connected', '내 자료']];

function ToolIcon({ kind }: { kind: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'slides' ? <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M12 17v4m-4 0h8M7 13V9m5 4V7m5 6v-3" /></>
      : kind === 'table' ? <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M3 9h18M9 9v12m-6-6h18" /></>
      : kind === 'search' ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5M8 8h5m-5 4h3" /></>
      : kind === 'study' ? <><path d="M8 15c-5-4-2-12 4-12s9 8 4 12l-1 2H9zM9 20h6m-5 2h4" /></>
      : kind === 'mail' ? <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></>
      : <><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6" />{kind === 'pdf' && <path d="m9 8 1 1 2-2" />}{kind === 'notebook' && <path d="M3 7h4M3 12h4m-4 5h4" />}</>}
  </svg>;
}

export function SkillHub() {
  const [group, setGroup] = useState<Group>('all');
  const [busy, setBusy] = useState('');
  const pending = useRef(false);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const entries = tools.flatMap(tool => {
    const entry = hub.entries.find(item => item.id === tool.id);
    return entry && (group === 'all' || tool.group === group) ? [{ ...tool, entry }] : [];
  });
  const start = async (entry: HubEntry, target: string, address?: string) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(entry.id);
    setNotice(null);
    try {
      if (isDesktop) {
        // Only the id and target cross the bridge. The app owns the URL and prompt.
        await command('start_hub_entry', { id: entry.id, target });
        setNotice({ id: entry.id, text: address ? '브라우저 열기를 요청했어요.' : 'AI에서 보내기를 눌러주세요.' });
      } else if (address) {
        window.open(address, '_blank', 'noopener,noreferrer');
      } else setNotice({ id: entry.id, text: '설치 앱에서 열 수 있어요.' });
    } catch {
      setNotice({ id: entry.id, text: '열지 못했어요. 앱 설치 상태를 확인해 주세요.' });
    } finally {
      pending.current = false;
      setBusy('');
    }
  };
  return <section className="skill-hub" aria-label="함께 쓰는 도구" data-agent-id="pet-selection.hub">
    <header><h2>함께 쓰는 도구</h2><p>문서, 조사, 내 자료를 더 쉽게.</p></header>
    <div className="skill-hub-kinds" role="group" aria-label="도구 용도">
      {groups.map(([id, label]) => <button key={id} aria-pressed={group === id} onClick={() => { setGroup(id); setNotice(null); }}>{label}</button>)}
    </div>
    <ul className="skill-hub-list">{entries.map(({ entry, name, summary, host, icon, group: purpose }) => {
      const action = entry.starts[0];
      const actionLabel = purpose === 'connected' ? '연결 설정' : action ? '열기' : '사용법';
      return <li key={entry.id} data-hub-entry={entry.id}>
        <span className={`skill-hub-icon icon-${icon}`}><ToolIcon kind={icon} /></span>
        <div className="skill-hub-description"><h3>{name}</h3><p>{summary}</p><small>{host}</small></div>
        <button type="button" className="skill-hub-open" aria-label={`${name} ${actionLabel === '사용법' ? '사용법 보기' : actionLabel}`} disabled={Boolean(busy)} onClick={() => void start(entry, action?.target ?? 'source', action ? action.url : entry.source)}>
          {busy === entry.id ? '여는 중…' : actionLabel} <span aria-hidden="true">↗</span>
        </button>
        <details className="skill-hub-detail"><summary aria-label={`${name} 이용 조건`}>이용 조건</summary>
          <div><p>{entry.needs}</p>{entry.note && <p>{entry.note}</p>}
            <button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => void start(entry, 'source', entry.source)}>{entry.publisher} 공식 안내 ↗</button>
            <small>{hub.verifiedAt} 공식 정보 확인</small>
          </div>
        </details>
        {notice?.id === entry.id && <p className="skill-hub-notice" role="status">{notice.text}</p>}
      </li>;
    })}</ul>
  </section>;
}
