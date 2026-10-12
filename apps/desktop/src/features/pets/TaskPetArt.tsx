import { useId } from 'react';
import { Pet, type PetMotion } from './Pet';
import type { PetCatalogEntry } from './petCatalog';
import { SourceLogo, skillSourceFor } from './PetSkillSource';

// Presentation only: a prop describes the role, never a connected or running tool.
export function TaskPetArt({ entry, motion = 'idle', paused = true, small = false }: { entry?: PetCatalogEntry; motion?: PetMotion; paused?: boolean; small?: boolean }) {
  const id = useId().replace(/:/g, '');
  const role = entry?.id ?? 'ui-webpage';
  return <span className={`task-pet-art ${small ? 'compact' : ''}`} data-role={role}>
    <Pet motion={motion} paused={paused} />
    <svg className="task-pet-prop" viewBox="0 0 96 88" aria-hidden="true">
      <defs><linearGradient id={`${id}-paper`} x2=".8" y2="1"><stop stopColor="#fffef9" /><stop offset="1" stopColor="#e1e7d7" /></linearGradient><linearGradient id={`${id}-body`} x2=".8" y2="1"><stop stopColor="#679482" /><stop offset="1" stopColor="#274f43" /></linearGradient></defs>
      <ellipse cx="49" cy="79" rx="35" ry="5" fill="#173a2c" opacity=".12" />
      {role === 'daily-plan' ? <g transform="rotate(-8 48 45)"><rect x="24" y="10" width="49" height="65" rx="8" fill={`url(#${id}-body)`} /><rect x="29" y="16" width="39" height="53" rx="4" fill={`url(#${id}-paper)`} /><rect x="38" y="6" width="20" height="13" rx="5" fill="#caaa68" /><path d="m35 31 3 3 5-6m-8 20 3 3 5-6m-8 20 3 3 5-6M49 31h12M49 48h12M49 65h9" fill="none" stroke="#5e806e" strokeWidth="3" strokeLinecap="round" /></g>
      : role === 'travel-plan' ? <g><path d="m11 26 23-9 26 8 25-9v54l-25 8-26-8-23 9z" fill={`url(#${id}-paper)`} stroke="#b5c5b8" strokeWidth="2" /><path d="M34 18v51m26-43v50M19 54l18-12 15 13 20-20" fill="none" stroke="#90ad98" strokeWidth="3" strokeDasharray="4 4" /><path d="M77 26c0 9-13 23-13 23S51 35 51 26a13 13 0 0 1 26 0" fill="#db986e" /><circle cx="64" cy="25" r="5" fill="#fff9e8" /></g>
      : role === 'study-helper' ? <g><path d="M11 19q22-8 37 2 15-10 37-2v54q-21-6-37 2-16-8-37-2z" fill={`url(#${id}-body)`} /><path d="M17 13q17-4 31 5 14-9 31-5v52q-16-4-31 5-15-9-31-5z" fill={`url(#${id}-paper)`} /><path d="M48 20v48M25 28l14 3m-14 10 14 3m-14 10 14 3m18-26 14-3m-14 16 14-3m-14 16 14-3" stroke="#aabca7" strokeWidth="2" strokeLinecap="round" /></g>
      : role === 'marketing-copy' ? <g transform="rotate(5 48 45)"><rect x="16" y="17" width="51" height="58" rx="7" fill={`url(#${id}-paper)`} stroke="#c3cebb" /><path d="M26 31h30M26 42h25M26 53h29M26 64h17" stroke="#a8bda7" strokeWidth="3" strokeLinecap="round" /><g transform="rotate(24 68 40)"><rect x="63" y="8" width="12" height="54" rx="3" fill="#d2ad60" /><path d="m63 61 6 14 6-14" fill="#e6c9a0" /><path d="m66 69 3 6 3-6" fill="#466156" /><path d="M69 14v44" stroke="#f5dca5" strokeWidth="3" /></g></g>
      : role === 'presentation' ? <g><path d="M46 56 26 80m22-24 22 24" stroke="#a5b2a0" strokeWidth="5" strokeLinecap="round" /><rect x="10" y="13" width="76" height="51" rx="6" fill={`url(#${id}-body)`} /><rect x="15" y="18" width="66" height="40" rx="3" fill={`url(#${id}-paper)`} /><path d="M23 28h39" stroke="#789482" strokeWidth="4" strokeLinecap="round" /><rect x="23" y="40" width="11" height="10" rx="2" fill="#ccaa68" /><rect x="39" y="35" width="11" height="15" rx="2" fill="#a7bba1" /><rect x="55" y="31" width="11" height="19" rx="2" fill="#618a75" /></g>
      : <g><rect x="15" y="13" width="68" height="48" rx="6" fill={`url(#${id}-body)`} /><rect x="20" y="18" width="58" height="37" rx="3" fill="#e8efe0" /><rect x="27" y="25" width="26" height="5" rx="2" fill="#799b87" /><rect x="27" y="35" width="22" height="12" rx="3" fill="#b1c6ae" /><rect x="55" y="25" width="16" height="22" rx="3" fill="#d3b47b" /><path d="M15 61h68l10 11q0 5-8 5H13q-8 0-8-5z" fill="#b5c2b2" /><path d="M39 63h20l4 5H35z" fill="#839a87" /></g>}
    </svg>
    {entry && <span className="pet-origin-badge" title={skillSourceFor(entry).source ? 'GitHub에 공개된 스킬 기반' : 'AutoPets 자체 제작'}><SourceLogo external={!!skillSourceFor(entry).source} /></span>}
  </span>;
}

export function ResultPreview({ entry }: { entry: PetCatalogEntry }) {
  const content: Record<string, { input: string; title: string; lines: string[] }> = {
    'daily-plan': { input: '14시부터 3시간. 초안 60분, 장보기 40분, 산책 30분을 하고 싶어요.', title: '할 일 세 가지와 쉬는 시간', lines: ['14:00–15:00  초안 정리', '15:00–15:40  장보기', '15:40–16:10  산책 · 남은 50분은 여유'] },
    'travel-plan': { input: '부산 1박 2일. 바다와 전시를 보고 카페에서 쉬고 싶어요.', title: '이동을 생각한 일정 초안', lines: ['첫날  바다 산책 → 가까운 전시', '둘째 날  동네 카페 → 귀가', '위치·운영시간을 확인하고 동선 확정'] },
    'study-helper': { input: '기회비용을 쉽게 설명하고, 이해했는지 문제를 내주세요.', title: '선택하면 포기하는 것도 있어요', lines: ['예: 같은 시간에 영화와 독서 중 하나 선택', '영화를 택하면 포기한 독서의 가치가 기회비용', '복습: 포기한 모든 선택의 합일까요?'] },
    'ui-webpage': { input: '가상 학과 행사 소개, 일정, 신청 안내를 한 페이지에 담아주세요.', title: '우리의 가을, 함께하는 하루', lines: ['가상 학과 행사 · 10월 24일', '소개    일정    참여 안내', '참여 안내 보기  ↗'] },
    'marketing-copy': { input: 'A5 무지 노트, 40매, 표지 2색. 짧은 소개와 버튼 문구가 필요해요.', title: '작은 한 권에, 자유로운 기록', lines: ['A5 무지 40매에 생각을 담으세요.', '두 가지 표지 중 마음에 드는 색을 골라요.', '노트 살펴보기  →'] },
    presentation: { input: '가상 학과 행사를 소개할 3분 발표. 슬라이드 4장으로 정리해 주세요.', title: '함께 만드는 학과의 하루', lines: ['01 / 04     행사 소개', '행사 취지 → 일정 → 신청 안내 → 마무리', '브라우저에서 넘겨 보는 발표'] },
  };
  const example = content[entry.id] ?? content['ui-webpage'];
  return <figure className={`result-preview result-${entry.id}`} aria-label={`${entry.name} 결과 예시`}>
    <figcaption><span>{entry.output}</span><small>AutoPets 설명용 예시</small></figcaption>
    <div className="result-preview-before"><span>입력 예시</span><p>{example.input}</p></div>
    <div className="result-preview-transition" aria-hidden="true">↓</div>
    <div className="result-preview-after"><span>결과 예시</span><div className="result-preview-paper"><span className="result-preview-mark" aria-hidden="true">{entry.symbol}</span><strong>{example.title}</strong>{example.lines.map(line => <span key={line}>{line}</span>)}</div></div>
    <p className="result-preview-note">AutoPets가 만든 구성 예시이며, 실제 생성 결과는 아니에요.</p>
  </figure>;
}
