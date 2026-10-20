import type { PetRoleTemplate } from '@autopets/contracts/types';
import { Pet } from './Pet';
import { catalogFor } from './petCatalog';

/** Shows saved configuration; does not imply a task has executed. */
export function PetComposition({ template, profile }: {
  template: PetRoleTemplate; profile: string; compact?: boolean;
}) {
  const entry = catalogFor(template);
  return <section className="pet-composition-summary" aria-label="선택한 펫 조합">
    <header><Pet small /><strong>{entry?.name ?? template.name}</strong></header>
    <div><span>일하는 방식</span><strong>{profile}</strong></div>
    <p>{template.planFirst ? '계획 확인 후 제작' : '채팅에서 바로 결과 받기'} · {entry?.output ?? '저장한 작업 방법'}</p>
  </section>;
}
