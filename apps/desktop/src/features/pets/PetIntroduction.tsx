export function FavoriteButton({ selected, onClick, disabled = false, label = 'UI 제작 펫 즐겨찾기' }: { selected: boolean; onClick: () => void; disabled?: boolean; label?: string }) {
  return <button type="button" className="pet-favorite-button" aria-label={label} aria-pressed={selected} disabled={disabled} onClick={onClick}><span aria-hidden="true">{selected ? '★' : '☆'}</span>{selected ? '즐겨찾는 펫' : '즐겨찾기'}</button>;
}

export function PetIntroduction() {
  return <>
    <dl className="pet-fit"><div><dt>잘하는 일</dt><dd>막연한 아이디어를 계획부터 웹페이지 제작까지 이어줘요.</dd></div><div><dt>아쉬운 점</dt><dd>로그인·결제 같은 복잡한 기능은 추가 작업이 필요해요.</dd></div></dl>
    <section className="pet-transformation" aria-label="사용 전후 예시">
      <header><h2>이렇게 달라져요</h2><span>설명용 예시</span></header>
      <div className="pet-example-pair">
        <div className="pet-example-before"><span className="pet-example-label">사용 전 · 흩어진 메모</span><strong>학과 행사 페이지가 필요한데…</strong><p>행사 소개, 일정, 신청 안내.<br />무엇부터 만들어야 할지 막막해요.</p></div>
        <div className="pet-example-after"><span className="pet-example-label">사용 후 · 한 장의 웹페이지</span><div className="pet-example-page"><span>가상 학과 오픈데이</span><strong>우리의 다음을<br />만나는 하루</strong><div><span>행사 소개</span><span>오늘의 일정</span></div><span className="pet-example-cta">신청 안내</span></div></div>
      </div>
      <p>계획을 확인한 뒤 만드는 결과물의 예시예요. 실제 결과는 요청에 따라 달라져요.</p>
    </section>
    <div className="pet-chat-promise"><span aria-hidden="true">↗</span><div><strong>쓰던 채팅에서, 펫을 불러요.</strong><p>처음 한 번 준비하면 Codex 채팅에서 요청하고 결과까지 받아요.</p><small>현재 Windows 로컬 Codex 지원 · Chat·Work는 준비 중</small></div></div>
  </>;
}
