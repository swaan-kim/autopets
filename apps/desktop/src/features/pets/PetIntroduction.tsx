import { petCatalog, type PetCatalogEntry } from './petCatalog';
export function FavoriteButton({ selected, onClick, disabled = false, label = 'UI 제작 펫 즐겨찾기' }: { selected: boolean; onClick: () => void; disabled?: boolean; label?: string }) {
  return <button type="button" className="pet-favorite-button" aria-label={label} aria-pressed={selected} disabled={disabled} onClick={onClick}><span aria-hidden="true">{selected ? '★' : '☆'}</span>{selected ? '즐겨찾는 펫' : '즐겨찾기'}</button>;
}

export function PetIntroduction({ entry = petCatalog.find(item => item.id === 'ui-webpage')! }: { entry?: PetCatalogEntry }) {
  return <>
    <details className="pet-example-disclosure"><summary>어떤 결과가 나오나요? <span>예시 보기</span></summary>
      <dl className="pet-fit"><div><dt>잘하는 일</dt><dd>{entry.summary}</dd></div><div><dt>한계</dt><dd>{entry.limit}</dd></div></dl>
      <section className="pet-transformation" aria-label="사용 전후 예시"><header><h2>이렇게 달라져요</h2><span>설명용 예시</span></header>
        <div className="pet-example-pair"><div className="pet-example-before"><span>사용 전</span><p>{entry.before}</p></div><div className="pet-example-after"><span>사용 후</span><p>{entry.after}</p></div></div>
        <p>AutoPets가 만든 설명용 예시예요. 스킬 적용 효과를 비교한 실험은 아니에요.</p>
      </section>
    </details>
  </>;
}
