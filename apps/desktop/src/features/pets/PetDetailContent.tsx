import type { PetCatalogEntry } from './petCatalog';
import { PetSkillSource } from './PetSkillSource';
import { resultSections } from './ResultSamples';

export function PetDetailExample({ entry }: { entry: PetCatalogEntry }) {
  const example = resultSections[entry.id];
  return <details className="pet-disclosure pet-detail-example" data-agent-id="pet-selection.detail.example" data-evidence="design-example">
    <summary>요청과 결과 예시</summary>
    <div className="pet-detail-example-body">
      <p className="pet-detail-example-request">{entry.example}</p>
      <div className="pet-detail-example-result">
        <h2>{example?.format ?? entry.output} <small>디자인 예시</small></h2>
        <p>{example?.takeaway ?? entry.after}</p>
      </div>
    </div>
  </details>;
}

export function PetDetailSource({ entry }: { entry: PetCatalogEntry }) {
  return <details className="pet-disclosure pet-detail-source" data-agent-id="pet-selection.detail.source">
    <summary>스킬 출처</summary>
    <PetSkillSource entry={entry} />
  </details>;
}
