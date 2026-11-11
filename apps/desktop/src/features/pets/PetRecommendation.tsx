import type { PetRecommendation, Snapshot } from '@autopets/contracts/types';
import { useAction } from '../../bridge/useAction';
import { petCatalog } from './petCatalog';
import { TaskPetArt } from './TaskPetArt';
import './pet-recommendation.css';

/** Only existing catalog pets can be shown; an unknown id is never replaced by a placeholder. */
export const recommendedEntry = (petId: string) => petCatalog.find(entry => entry.id === petId);
export const visibleRecommendation = (snapshot: Snapshot, threadId: string) => snapshot.petRecommendations?.find(item =>
  item.target.threadId === threadId && ['preparing', 'shown', 'accepted', 'running'].includes(item.state));
const quote = (text: string | null, max = 90) => !text ? '' : text.length > max ? `${text.slice(0, max)}…` : text;

export function recommendationStatus(item: PetRecommendation): string {
  if (item.state === 'preparing') return '요청 살펴보는 중';
  const accepted = item.acceptedPetId ? recommendedEntry(item.acceptedPetId)?.name : undefined;
  if (item.state === 'accepted') return `${accepted ?? '펫'} 설정 중`;
  if (item.state === 'running') return `${accepted ?? '펫'} 작업 중`;
  const first = recommendedEntry(item.candidates[0]?.petId ?? '');
  return first ? `추천 · ${first.name}` : '추천';
}

/** Small card on the chat's pet (and in the app). Accepting only opens the existing pet composer. */
export function PetRecommendationCard({ item, compact = false, linked = true }: { item: PetRecommendation; compact?: boolean; linked?: boolean }) {
  const action = useAction();
  const candidates = item.candidates.map(candidate => ({ candidate, entry: recommendedEntry(candidate.petId) })).filter(value => value.entry);
  const accept = (petId: string, other = false) => void action.run('respond_pet_recommendation', { id: item.id, response: { action: 'accept', petId, other } });
  const dismiss = () => void action.run('respond_pet_recommendation', { id: item.id, response: { action: 'dismiss' } });
  const browse = () => void action.run('browse_pet_recommendation', { id: item.id });
  const chat = `채팅 · ${item.target.threadId.slice(-8)}`;
  return <section className={`pet-recommendation ${compact ? 'compact' : ''}`} data-state={item.state} data-agent-id="pet-recommendation.card" aria-label="Codex 요청에 맞는 펫 추천">
    <header className="pet-recommendation-header"><strong>{item.state === 'preparing' ? 'Codex 요청 확인 중' : '이 요청에 맞는 펫'}</strong><small title={item.target.threadId}>{chat}</small></header>
    {item.request && <blockquote className="pet-recommendation-request" title={item.request}>“{quote(item.request)}”</blockquote>}
    {item.state === 'preparing' && <p className="pet-recommendation-note" role="status">보낸 요청에 맞는 펫이 있는지 확인하고 있어요.</p>}
    {item.state === 'shown' && <>
      <ol className="pet-recommendation-list">{candidates.map(({ candidate, entry }, index) => <li key={candidate.petId} data-pet={candidate.petId}>
        <div className="pet-recommendation-pet"><TaskPetArt entry={entry} small paused interactive={false} /><div>
          <h3>{candidates.length > 1 && <span aria-hidden="true">{index + 1}. </span>}{entry!.name}</h3>
          <p className="pet-recommendation-summary">{entry!.summary}</p>
        </div></div>
        <p className="pet-recommendation-reason">{candidate.reason} {entry!.name} 펫을 사용해 볼까요?</p>
        {candidate.cues.length > 0 && <p className="pet-recommendation-cues">근거: {candidate.cues.join(' · ')}</p>}
        <button className="button primary" disabled={action.busy} onClick={() => accept(candidate.petId)} aria-label={`${entry!.name} 펫 사용하기`}>이 펫 사용하기</button>
      </li>)}</ol>
      {candidates.length > 1 && <p className="pet-recommendation-note">여러 작업이 함께 있어요. 먼저 쓸 펫 하나를 골라 주세요.</p>}
      <div className="pet-recommendation-actions"><button className="text-button" disabled={action.busy} onClick={browse}>다른 펫 보기</button><button className="text-button" disabled={action.busy} onClick={dismiss}>추천 닫기</button></div>
    </>}
    {item.state === 'accepted' && <>
      <p className="pet-recommendation-note" role="status">{linked
        ? <>앱에서 펫 설정을 이어가세요. 적용한 뒤 같은 Codex 채팅에 “{recommendedEntry(item.acceptedPetId ?? '')?.name ?? '이'} 펫으로 진행해줘”라고 보내면 시작해요.</>
        : <>앱에서 펫 설정을 이어가세요. ‘직접 요청’에서 시작 요청을 복사해 같은 Codex 채팅에 보내면 펫이 연결되고 이 요청을 진행해요.</>}</p>
      <div className="pet-recommendation-actions"><button className="text-button" disabled={action.busy} onClick={() => accept(item.acceptedPetId ?? '', true)}>설정 화면 열기</button><button className="text-button" disabled={action.busy} onClick={dismiss}>추천 닫기</button></div>
    </>}
    {item.state === 'running' && <p className="pet-recommendation-note" role="status">추천한 펫이 이 채팅에서 일하고 있어요.</p>}
    {!compact && item.requestTruncated && <p className="pet-recommendation-note">요청이 길어서 앞부분만 가져왔어요.</p>}
    {action.error && <p role="alert">추천을 처리하지 못했어요. 앱 연결을 확인해 주세요.</p>}
  </section>;
}
