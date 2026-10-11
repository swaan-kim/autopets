import type { ReactNode } from 'react';
import type { PetLink, SavedPet } from '@autopets/contracts/types';
import { petCatalog, catalogFor, type PetCatalogEntry } from './petCatalog';
import { TaskPetArt } from './TaskPetArt';
import { FavoriteButton } from './PetIntroduction';
import { ExplicitPet } from './ExplicitPet';
import { PetSkillSource } from './PetSkillSource';

export type PetWorkspaceView = 'pets' | 'catalog' | 'saved';
const groupFor = (link: PetLink, disconnected: boolean) => {
  if (disconnected || !link.connected || link.run?.trackingClosed || ['waiting', 'returned', 'failed', 'unknown'].includes(link.run?.state ?? '')) return 'attention';
  if (['requested', 'working'].includes(link.run?.state ?? '')) return 'working';
  if (link.run?.state === 'complete') return 'complete';
  return 'ready';
};

export function PetWorkspace({ view, active, category, onCategory, links, disconnected, legacy, pets, favorites, onFavorite, onSelect, onSaved, onBrowse, error }: {
  view: PetWorkspaceView; active: boolean; category: 'all' | 'daily' | 'work'; onCategory: (value: 'all' | 'daily' | 'work') => void;
  links: PetLink[]; disconnected: boolean; legacy?: ReactNode; pets: SavedPet[]; favorites: string[];
  onFavorite: (id: string) => void; onSelect: (entry: PetCatalogEntry) => void; onSaved: (pet: SavedPet) => void; onBrowse: () => void; error: string;
}) {
  const favoriteEntries = favorites.map(id => ({ id, entry: petCatalog.find(entry => id === `template:${entry.id}`), pet: pets.find(pet => id === `saved:${pet.id}`) }));
  const shelf = (items: typeof favoriteEntries) => <div className="workspace-saved-grid">{items.map(({ id, entry, pet }) => {
    const current = pet ? catalogFor(pet.template) : entry;
    return <article key={id} className="workspace-saved-card"><TaskPetArt entry={current} small /><div><h3>{pet?.template.name ?? entry?.template.name ?? '찾을 수 없는 펫'}</h3><p>{current?.output ?? '저장한 구성을 다시 확인해 주세요.'}</p><button className="text-button" disabled={!current} onClick={() => pet ? onSaved(pet) : entry && onSelect(entry)}>이 펫 부르기 →</button></div><FavoriteButton selected={favorites.includes(id)} label={`${pet?.template.name ?? entry?.template.name ?? '펫'} 즐겨찾기`} onClick={() => onFavorite(id)} /></article>;
  })}</div>;
  return <div className="pet-workspace-v2" data-view={view}>
    {view === 'pets' && links.length === 0 && !legacy && <section className="workspace-welcome"><div><span className="workspace-kicker">내 일에 맞는 작은 동료</span><h1>하고 싶은 일,<br />펫과 함께 해요.</h1><p>할 일을 고르면 방법은 펫이 챙겨요.<br />결과는 쓰던 Codex 채팅에서 만나요.</p></div><TaskPetArt paused={!active} /></section>}
    {view === 'pets' && (links.length > 0 || legacy) && <>
      <header className="workspace-heading"><div><span className="workspace-kicker">함께하는 작업</span><h1>이어서 해볼까요?</h1><p>확인할 일부터, 끝난 작업의 결과까지.</p></div><button className="button secondary" onClick={onBrowse}>새 일 맡기기 +</button></header>
      <section className="workspace-activity workspace-activity-grid" aria-label="연결된 작업">
        {([['attention', '확인이 필요해요'], ['working', '함께하고 있어요'], ['complete', '최근 결과'], ['ready', '준비된 펫']] as const).flatMap(([group, label]) => {
          const items = links.filter(link => groupFor(link, disconnected) === group);
          return items.length ? [<h2 id={`activity-${group}`} key={group}>{label}<span>{items.length}</span></h2>, ...items.map(link => <article aria-describedby={`activity-${group}`} className={`workspace-live-card pet-card-${link.slot}`} key={JSON.stringify(link.target)}><ExplicitPet link={link} disconnected={disconnected} compact /></article>)] : [];
        })}
      </section>{legacy}
    </>}
    {view === 'catalog' && <header className="workspace-heading"><div><h1>어떤 일을 맡길까요?</h1><p>공유된 스킬과 직접 만든 작업 방법을, 펫으로 쉽게 골라 써요.</p></div></header>}
    {view === 'saved' && <header className="workspace-heading"><div><span className="workspace-kicker">나에게 맞춰 둔 동료</span><h1>내 펫</h1><p>좋아하는 펫을 꺼내, 쓰던 방식 그대로.</p></div><button className="button secondary" onClick={onBrowse}>펫 고르기</button></header>}
    {(view === 'saved' || view === 'pets' && favorites.length > 0) && <section className="pet-favorites workspace-favorites" aria-label="즐겨찾는 펫"><h2>즐겨찾기</h2>{favoriteEntries.length ? shelf(favoriteEntries) : <div className="workspace-empty"><p>마음에 드는 펫에 ☆를 눌러보세요.</p><button className="text-button" onClick={onBrowse}>펫 만나러 가기 →</button></div>}</section>}
    {view === 'saved' && <section className="workspace-saved"><h2>저장한 구성</h2>{pets.length ? shelf(pets.map(pet => ({ id: `saved:${pet.id}`, pet, entry: undefined }))) : <p className="workspace-note">펫에게 맡기면 선택한 방식이 여기에 저장돼요.</p>}</section>}
    {(view === 'catalog' || view === 'pets' && !links.length) && <section className="workspace-library" aria-label="할 일 고르기">
      <div className="workspace-library-heading"><div className="pet-category-tabs" role="group" aria-label="할 일 분류">{(['all', 'daily', 'work'] as const).map(id => <button key={id} aria-pressed={category === id} onClick={() => onCategory(id)}>{id === 'all' ? '전체' : id === 'daily' ? '일상' : '업무'}</button>)}</div><span className="workspace-note">마음에 드는 펫은 ☆로 저장해요</span></div>
      <div className="workspace-role-grid">{petCatalog.filter(entry => category === 'all' || entry.category === category).map(entry => <article className="workspace-role-card" key={entry.id} data-role={entry.id}><FavoriteButton selected={favorites.includes(`template:${entry.id}`)} label={`${entry.name} 즐겨찾기`} onClick={() => onFavorite(`template:${entry.id}`)} /><button className="workspace-role-select" aria-label={`${entry.name} 펫 선택`} onClick={() => onSelect(entry)}><TaskPetArt entry={entry} /><h3>{entry.name}</h3><p>{entry.summary}</p><PetSkillSource entry={entry} compact /><span className="workspace-role-action">이 펫에게 맡기기 <span aria-hidden="true">↗</span></span></button></article>)}</div>
    </section>}
    {error && <p className="error" role="alert">{error}</p>}
    <footer className="workspace-caption">펫은 일을 돕고, 대화와 결과는 Codex에 그대로.</footer>
  </div>;
}
