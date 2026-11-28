export type PresentationPreferences = { format: 'recommend' | 'html' | 'figma' | 'pptx'; design: string; reference: boolean };
export const defaultPresentation: PresentationPreferences = { format: 'recommend', design: '', reference: false };

export function PresentationOptions({ value, disabled, onChange }: { value: PresentationPreferences; disabled: boolean; onChange: (value: PresentationPreferences) => void }) {
  return <div className="presentation-options" data-agent-id="pet-selection.composer.presentation">
    <label className="ui-pet-select">결과 형식
      <select aria-label="발표자료 결과 형식" disabled={disabled} value={value.format} onChange={event => onChange({ ...value, format: event.target.value as PresentationPreferences['format'] })}>
        <option value="recommend">추천받기</option><option value="html">HTML · 브라우저 발표</option>
        <option value="figma">Figma · 디자인 편집</option><option value="pptx">PPTX · PowerPoint</option>
      </select>
    </label>
    <details className="presentation-design">
      <summary>디자인·참고 자료 (선택)</summary>
      <label className="ui-pet-select">원하는 분위기·색상 (선택)
        <input aria-label="발표자료 분위기·색상 (선택)" value={value.design} maxLength={80} disabled={disabled}
          placeholder="예: 차분한 네이비와 아이보리" onChange={event => onChange({ ...value, design: event.target.value })} />
      </label>
      <label className="presentation-reference"><input type="checkbox" checked={value.reference} disabled={disabled} onChange={event => onChange({ ...value, reference: event.target.checked })} />
        <span>참고 사진을 AI 채팅에 첨부할게요 (선택)</span></label>
      <p>사진 없이도 주제에 맞는 디자인을 추천해요.</p>
    </details>
    <p className="presentation-plan-hint">형식·디자인·사용할 스킬을 제안받고, 계획을 고친 뒤 만들어요.</p>
  </div>;
}
