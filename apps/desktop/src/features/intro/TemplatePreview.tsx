import type { IntroTemplateId } from '@autopets/contracts/types';
import catalog from '../../../../../packages/contracts/data/intro-templates.json';

/** Deterministic layout examples, deliberately separate from user output. */
export function TemplatePreview({ templateId }: { templateId: IntroTemplateId }) {
  const example = catalog.templates.find(template => template.id === templateId)!.example;
  return <svg className="intro-template-preview" viewBox="0 0 300 172" role="img" aria-label="레이아웃 예시 · 생성 결과 아님">
    <rect width="300" height="172" rx="12" fill="#f5f7f2" />
    <rect x="17" y="16" width="266" height="140" rx="6" fill="white" />
    <text x="31" y="32" fontSize="7" fill="#799166">내용·구성 예시</text>
    <text x="31" y="53" fontSize="14" fontWeight="700" fill="#3e5547">{example.message}</text>
    <text x="31" y="66" fontSize="7" fill="#8b9b80">{example.audience}에게 전하는 한 장</text>
    {templateId === 'product-intro' ? <>
      <rect x="31" y="79" width="110" height="61" rx="5" fill="#e6eddd" /><circle cx="86" cy="109" r="18" fill="#a8bd92" /><path d="M80 109l5 5 11-12" fill="none" stroke="#fff" strokeWidth="3" />
      {example.points.map((point, i) => <g key={point}><circle cx="163" cy={86 + i * 23} r="4" fill="#8fa278" /><text x="175" y={90 + i * 23} fontSize="10" fill="#536b49">{point}</text></g>)}
    </> : templateId === 'plan-summary' ? <>
      <path d="M57 96H241" stroke="#d8e0cf" strokeWidth="2" />{['메뉴 고민', '후보 모으기', '팀에서 사용'].map((label, i) => <g key={label}><circle cx={57 + i * 92} cy="96" r="11" fill={i === 1 ? '#66805d' : '#b8c7a7'} /><text x={57 + i * 92} y="100" textAnchor="middle" fill="white" fontSize="10">{i + 1}</text><text x={57 + i * 92} y="123" textAnchor="middle" fontSize="9" fill="#536b49">{label}</text></g>)}
    </> : <>{['실시간 회의', '비동기 문서'].map((label, i) => <g key={label}><rect x={31 + i * 123} y="77" width="114" height="65" rx="5" fill={i ? '#e6eddd' : '#f1f3ef'} /><text x={43 + i * 123} y="97" fontSize="11" fontWeight="600" fill="#536b49">{label}</text><text x={43 + i * 123} y="116" fontSize="9" fill="#809275">{i ? '각자 읽고 답변' : '즉시 의견 교환'}</text><text x={43 + i * 123} y="131" fontSize="8" fill="#809275">{i ? '시간을 두고 검토' : '빠른 논의에'}</text></g>)}</>}
  </svg>;
}
