import { useRef, useState } from 'react';
import type { PetLink } from '@autopets/contracts/types';
import hub from '../../../../../packages/contracts/data/skill-hub.json';
import { command, isDesktop } from '../../bridge/command';
import { chatName, useCodexChatTitles } from './useCodexChatTitles';
import { SkillHub } from './SkillHub';

const featured = [
  { id: 'research-literature-review', field: '문헌 연구', stars: '5.86만', installs: '2,700',
    example: '논문 A는 복습 직후, B는 일주일 뒤에 기억력을 측정했어요. 같은 시점의 점수가 없어 두 방법의 장기 효과는 아직 비교하기 어려워요.' },
  { id: 'research-ml-paper', field: '논문 작성', stars: '1.48만', installs: '2,700',
    example: '결과 표에서 정확도는 82%에서 85%로 올랐어요. 초안에는 3%p 차이를 쓰고, 시드별 편차가 없어 재현성은 확인 과제로 남겨요.' },
  { id: 'research-interviews', field: '제품 리서치', stars: '3.70만', installs: '3,300',
    example: '5명 중 3명이 제출 후 진행 상태를 찾지 못했어요. P2는 “메일로 확인해서 괜찮았다”고 했어요. 첫 개선 후보는 제출 직후의 상태 안내예요.' },
] as const;

const selectionKey = (link: PetLink) => JSON.stringify([link.target.threadId, link.target.cwd, link.revision]);

function InterviewStart({ links }: { links: PetLink[] }) {
  const available = links.filter(link => link.connected && link.enabled &&
    (!link.run || link.run.trackingClosed || !['requested', 'working', 'returned', 'unknown'].includes(link.run.state)));
  const titles = useCodexChatTitles(available.map(link => link.target.threadId));
  const [selection, setSelection] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [notice, setNotice] = useState('');
  const selected = available.find(link => selectionKey(link) === selection);
  const stale = Boolean(selection && !selected);
  const start = async () => {
    if (pending.current || stale) return;
    if (!isDesktop) {
      setNotice('스킬이 포함된 Windows AutoPets 앱에서 열어 주세요.');
      return;
    }
    pending.current = true;
    setBusy(true);
    setNotice('');
    try {
      await command('open_interview_in_codex', { target: selected?.target ?? null, expectedRevision: selected?.revision ?? null });
      setNotice('Codex 열기를 요청했어요. 채팅에서 인터뷰 자료와 결정할 질문을 추가하고 보내세요.');
    } catch (error) {
      setNotice(typeof error === 'string' ? error : 'Codex를 열지 못했어요. 설치 상태를 확인하고 다시 시도해 주세요.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return <div className="research-start">
    {(available.length > 0 || selection) && <label>사용할 채팅
      <select value={selection} disabled={busy} onChange={event => { setSelection(event.target.value); setNotice(''); }}>
        <option value="">새 Codex 채팅</option>
        {stale && <option value={selection} disabled>연결이 바뀌었어요. 다시 선택해 주세요.</option>}
        {available.map(link => <option key={selectionKey(link)} value={selectionKey(link)}>{chatName(titles, link.target)} · {link.template.name}</option>)}
      </select>
    </label>}
    <button type="button" className="button" disabled={busy || stale} onClick={() => void start()}>
      {busy ? '여는 중…' : selected ? '선택한 Codex 채팅에서 사용' : '새 Codex 채팅에서 사용'}
    </button>
    {notice && <p role="status">{notice}</p>}
  </div>;
}

export function ResearchSkills({ links }: { links: PetLink[] }) {
  const [sourceError, setSourceError] = useState('');
  const openSource = async (entry: (typeof hub.entries)[number]) => {
    setSourceError('');
    try {
      if (isDesktop) await command('start_hub_entry', { id: entry.id, target: 'source' });
      else window.open(entry.source, '_blank', 'noopener,noreferrer');
    } catch {
      setSourceError(entry.id);
    }
  };
  return <section className="research-skills" aria-label="스킬·도구" data-agent-id="pet-selection.skills">
    <h2>추천 스킬</h2>
    <div className="research-grid">{featured.map(skill => {
      const entry = hub.entries.find(item => item.id === skill.id)!;
      return <article key={skill.id} data-hub-entry={skill.id}>
        <small>{skill.field}</small>
        <h3>{entry.name}</h3>
        <p>{entry.summary}</p>
        <dl><dt>준비할 자료</dt><dd>{entry.needs}</dd><dt>받을 결과</dt><dd>{entry.note}</dd></dl>
        <details className="research-example"><summary>결과 예시 보기</summary><p>{skill.example}</p></details>
        {skill.id === 'research-interviews' && <InterviewStart links={links} />}
        <details className="research-source"><summary>출처와 사용 지표</summary>
          <button type="button" className="text-button" onClick={() => void openSource(entry)}>{entry.publisher} 원본 보기 ↗</button>
          <p>GitHub 저장소 별 {skill.stars}개 · skills.sh 스킬 설치 약 {skill.installs}회</p>
          <small>2026년 11월 27일 확인</small>
          {sourceError === entry.id && <p role="status">공식 안내를 열지 못했어요. 다시 시도해 주세요.</p>}
        </details>
      </article>;
    })}</div>
    <details className="pet-disclosure"><summary>기본 도구</summary><SkillHub /></details>
  </section>;
}
