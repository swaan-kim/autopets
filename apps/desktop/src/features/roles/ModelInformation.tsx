import { modelInformation } from '../../../../../packages/contracts/model-information.mjs';

export function ModelInformation({ model, surface }: { model: string; surface?: string }) {
  const info = modelInformation(model, surface);
  return <aside className="model-information" aria-label={`${model} 모델 정보`}>
    <strong>{model}</strong>
    {info.status === 'unknown' ? <p>이 모델·환경의 비교 자료는 아직 미확인이에요.</p> : <>
      {info.status === 'stale' ? <p role="status">오래된 자료 · 다시 확인하기 전에는 비교에 사용하지 않아요.</p> : <p>{info.axis} · {info.summary}</p>}
      <p className="small-note">{info.conditions}</p>
      <p className="small-note">공식 발표 {info.publishedAt} · 자료 확인 {info.reviewedAt}</p>
      <a href={info.sourceUrl} target="_blank" rel="noreferrer">{info.sourceTitle}</a>
    </>}
    <p className="small-note">현재 작업의 가용성·실제 적용 여부는 연결에서 따로 확인해요.</p>
  </aside>;
}
