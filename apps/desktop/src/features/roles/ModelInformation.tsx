import { modelInformation } from '../../../../../packages/contracts/model-information.mjs';

export function ModelInformation({ model, surface }: { model: string; surface?: string }) {
  const info = modelInformation(model, surface);
  return <aside className="model-information" aria-label={`${model} 모델 정보`}>
    <strong>{model}</strong>
    {info.status === 'unknown' ? <p>이 모델의 비교 자료는 아직 확인 못 했어요.</p> : <>
      {info.status === 'stale' ? <p role="status">오래된 자료예요. 다시 확인하기 전에는 비교에 쓰지 않아요.</p> : <p>{info.axis} · {info.summary}</p>}
      <p className="small-note">{info.conditions}</p>
      <p className="small-note">공식 발표 {info.publishedAt} · 자료 확인 {info.reviewedAt}</p>
      <a href={info.sourceUrl} target="_blank" rel="noreferrer">{info.sourceTitle}<span aria-hidden="true"> ↗</span></a>
    </>}
    <p className="small-note">이 작업에서 쓸 수 있는지, 실제로 적용됐는지는 따로 확인해요.</p>
  </aside>;
}
