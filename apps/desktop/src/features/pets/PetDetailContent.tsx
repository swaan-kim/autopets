import type { PetCatalogEntry } from './petCatalog';
import { PetSkillSource } from './PetSkillSource';

// Authored examples explain the format. They do not represent a run or start one.
function ExampleResult({ entry }: { entry: PetCatalogEntry }) {
  if (entry.id === 'daily-plan') return <ol className="pet-detail-example-list">
    <li><strong>보고서 초안</strong><span>먼저 집중할 일</span></li>
    <li><strong>장보기</strong><span>외출할 때 함께</span></li>
    <li><strong>산책</strong><span>마무리는 가볍게</span></li>
  </ol>;
  if (entry.id === 'travel-plan') return <dl className="pet-detail-example-rows">
    <div><dt>첫째 날</dt><dd>바다 산책 → 전시 관람</dd></div>
    <div><dt>둘째 날</dt><dd>동네 카페 → 돌아오기</dd></div>
  </dl>;
  if (entry.id === 'study-helper') return <div className="pet-detail-example-study">
    <p>한 시간 동안 책을 읽기로 했다면, 그 시간에 볼 수 있었던 영화가 포기한 대안이 될 수 있어요.</p>
    <p><strong>확인 문제</strong> 포기한 대안이 여러 개라면, 어떤 것의 가치를 비교해야 할까요?</p>
  </div>;
  if (entry.id === 'marketing-copy') return <div className="pet-detail-example-copy">
    <p><strong>우리 학과 행사, 한눈에.</strong></p>
    <p>일정부터 참가 방법까지, 흩어진 안내를 한곳에서 확인하세요.</p>
    <span>행사 살펴보기 →</span>
  </div>;
  if (entry.id === 'presentation') return <ol className="pet-detail-example-slides">
    {['행사를 소개해요', '함께할 프로그램', '하루 일정', '이렇게 참여해요', '다음 만남을 기다리며'].map((title, index) => <li key={title}><span>0{index + 1}</span><strong>{title}</strong></li>)}
  </ol>;
  if (entry.id === 'ui-webpage') return <div className="pet-detail-example-sections">
    {['행사 소개', '프로그램과 일정', '참가 안내', '모바일 화면'].map(label => <span key={label}>{label}</span>)}
  </div>;
  return <p>{entry.output}</p>;
}

export function PetDetailExample({ entry }: { entry: PetCatalogEntry }) {
  return <div className="pet-detail-reading">
    <section className="pet-detail-example" data-agent-id="pet-selection.detail.example" data-evidence="design-example" aria-label="요청과 결과 예시">
      <header><h2>이렇게 요청해 보세요</h2><span>디자인 예시</span></header>
      <div className="pet-detail-example-body">
        <p className="pet-detail-example-request">{entry.example}</p>
        <div className="pet-detail-example-result">
          <h3>{entry.output}</h3>
          <ExampleResult entry={entry} />
        </div>
      </div>
    </section>
    <section className="pet-detail-about" data-agent-id="pet-selection.detail.about">
      <h2>이런 일을 도와요</h2>
      <p>{entry.before}</p>
      <p>{entry.after}</p>
    </section>
  </div>;
}

export function PetDetailNotes({ entry, where }: { entry: PetCatalogEntry; where: string }) {
  return <>
    <section className="pet-detail-note" data-agent-id="pet-selection.detail.requirements" aria-label="사용 안내">
      <h2>사용 안내</h2>
      <dl>
        <div><dt>시작할 곳</dt><dd>{where}</dd></div>
        <div><dt>결과 형식</dt><dd>{entry.output}</dd></div>
      </dl>
      <p className="pet-detail-limit">{entry.limit}</p>
    </section>
    <section className="pet-detail-note" data-agent-id="pet-selection.detail.source" aria-label="만든 곳">
      <h2>만든 곳</h2>
      <PetSkillSource entry={entry} />
    </section>
  </>;
}
