import type { PetCatalogEntry } from './petCatalog';
import { PetSkillSource } from './PetSkillSource';
import { resultSections } from './ResultSamples';

export function PetDetailExample({ entry }: { entry: PetCatalogEntry }) {
  const example = resultSections[entry.id];
  return <div className="pet-detail-reading">
    <section className="pet-detail-example" data-agent-id="pet-selection.detail.example" data-evidence="design-example" aria-label="요청과 결과 예시">
      <header><h2>이렇게 요청해 보세요</h2><span>디자인 예시</span></header>
      <div className="pet-detail-example-body">
        <p className="pet-detail-example-request">{entry.example}</p>
        <div className="pet-detail-example-result">
          <h3>{example?.format ?? entry.output}</h3>
          <p>{example?.takeaway ?? entry.after}</p>
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
