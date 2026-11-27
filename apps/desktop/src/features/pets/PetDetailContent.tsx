import type { PetCatalogEntry } from './petCatalog';
import { PetSkillSource } from './PetSkillSource';
import { resultSections } from './ResultSamples';

export function PetDetailExample({ entry, onUseExample, busy }: { entry: PetCatalogEntry; onUseExample?: () => void; busy: boolean }) {
  const example = resultSections[entry.id];
  return <details className="pet-disclosure pet-detail-example" data-agent-id="pet-selection.detail.example" data-evidence="design-example">
    <summary>예시 요청 보기</summary>
    <div className="pet-detail-example-body">
      <p className="pet-detail-example-request">{entry.example}</p>
      <p className="pet-detail-example-result">{example?.takeaway ?? entry.after}</p>
      {onUseExample && <button type="button" className="button secondary" disabled={busy} onClick={onUseExample}>이 요청 써보기 <span aria-hidden="true">→</span></button>}
    </div>
  </details>;
}

export function PetDetailSource({ entry }: { entry: PetCatalogEntry }) {
  return <details className="pet-disclosure pet-detail-source" data-agent-id="pet-selection.detail.source">
    <summary>스킬 출처</summary>
    <PetSkillSource entry={entry} />
  </details>;
}
