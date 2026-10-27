import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PetLink, SavedPet } from '@autopets/contracts/types';
import { petCatalog, catalogFor, type PetCatalogEntry } from './petCatalog';
import { TaskPetArt, ResultPreview } from './TaskPetArt';
import { FavoriteButton } from './PetIntroduction';
import { ExplicitPet } from './ExplicitPet';
import { PetSkillSource } from './PetSkillSource';
import { PetHome } from './PetHome';

export type PetWorkspaceView = 'home' | 'pets' | 'catalog' | 'saved';
const groupFor = (link: PetLink, disconnected: boolean) => {
  if (disconnected || !link.connected || !link.enabled || link.run?.trackingClosed || ['waiting', 'returned', 'failed', 'unknown'].includes(link.run?.state ?? '')) return 'attention';
  if (['requested', 'working'].includes(link.run?.state ?? '')) return 'working';
  if (link.run?.state === 'complete') return 'complete';
  return 'ready';
};
const groups = [['attention', '확인이 필요해요'], ['working', '함께하고 있어요'], ['complete', '최근 결과'], ['ready', '준비된 펫']] as const;
const categoryNames = { all: '전체', daily: '일상', work: '업무' } as const;

export function PetWorkspace({ view, navigationRevision = 0, active, category, onCategory, links, disconnected, legacy, pets, favorites, onFavorite, onSelect, onSaved, onNewTask, onBrowse, error }: {
  view: PetWorkspaceView; active: boolean; category: 'all' | 'daily' | 'work'; onCategory: (value: 'all' | 'daily' | 'work') => void;
  links: PetLink[]; disconnected: boolean; legacy?: ReactNode; pets: SavedPet[]; favorites: string[];
  onFavorite: (id: string) => void; onSelect: (entry: PetCatalogEntry, request?: string) => void; onSaved: (pet: SavedPet) => void; onNewTask: (link: PetLink) => void; onBrowse: () => void; error: string;
  navigationRevision?: number;
}) {
  const [selected, setSelected] = useState<PetCatalogEntry | null>(null);
  const [shelfTab, setShelfTab] = useState<'all' | 'saved'>(view === 'saved' ? 'saved' : 'all');
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const returnRole = useRef<string | null>(null);
  useEffect(() => { setSelected(null); if (view === 'saved') setShelfTab('saved'); }, [view, navigationRevision]);
  const favoriteEntries = favorites.map(id => ({ id, entry: petCatalog.find(entry => id === `template:${entry.id}`), pet: pets.find(pet => id === `saved:${pet.id}`) }));
  const choose = (entry: PetCatalogEntry) => {
    returnRole.current = entry.id; setSelected(entry);
    requestAnimationFrame(() => { detailHeading.current?.focus({ preventScroll: true }); window.scrollTo(0, 0); });
  };
  const back = () => {
    setSelected(null);
    requestAnimationFrame(() => { const button = document.querySelector<HTMLButtonElement>(`.workspace-role-card[data-role="${returnRole.current}"] .workspace-role-select, .workspace-saved-card[data-role="${returnRole.current}"] .text-button`); button?.focus({ preventScroll: true }); button?.scrollIntoView({ block: 'nearest' }); });
  };
  const shelf = (items: typeof favoriteEntries, area: 'favorites' | 'saved') => <div className="workspace-saved-grid">{items.map(({ id, entry, pet }) => {
    const current = pet ? catalogFor(pet.template) : entry;
    return <article key={id} className="workspace-saved-card" data-role={current?.id} data-agent-id={`pet-selection.${area}.${id}`}><TaskPetArt entry={current} small /><div><h3>{pet?.template.name ?? entry?.template.name ?? '찾을 수 없는 펫'}</h3><p>{current?.output ?? '저장한 구성을 다시 확인해 주세요.'}</p><button className="text-button" disabled={!current} onClick={() => pet ? onSaved(pet) : entry && choose(entry)}>이 펫 부르기 →</button></div><FavoriteButton selected={favorites.includes(id)} label={`${pet?.template.name ?? entry?.template.name ?? '펫'} 즐겨찾기`} onClick={() => onFavorite(id)} /></article>;
  })}</div>;
  const liveCard = (link: PetLink, home = false) => <article className={`workspace-live-card pet-card-${link.slot}`} key={JSON.stringify(link.target)}><ExplicitPet link={link} disconnected={disconnected} compact showPet={!home} onNewTask={catalogFor(link.template) ? onNewTask : undefined} /></article>;
  const recent = groups.flatMap(([group]) => links.filter(link => groupFor(link, disconnected) === group)).slice(0, 3);
  const detail = selected && <section className="workspace-role-detail" data-agent-scope="pet-selection" data-agent-id="pet-selection.detail" data-role={selected.id} aria-label={`${selected.name} 살펴보기`}>
    <button className="text-button workspace-detail-back" data-agent-id="pet-selection.detail.back" onClick={back}>← 펫 목록</button>
    <div className="workspace-detail-layout">
      <div className="workspace-detail-preview" data-agent-id="pet-selection.detail.preview"><ResultPreview entry={selected} /></div>
      <div className="workspace-detail-content">
        <div className="workspace-detail-identity"><TaskPetArt entry={selected} small paused={!active} /><h2 ref={detailHeading} tabIndex={-1}>{selected.name}</h2><FavoriteButton selected={favorites.includes(`template:${selected.id}`)} label={`${selected.name} 즐겨찾기`} onClick={() => onFavorite(`template:${selected.id}`)} /></div>
        <p className="workspace-detail-summary">{selected.summary}</p>
        <PetSkillSource entry={selected} compact />
        <button className="button workspace-use-pet" data-agent-id="pet-selection.detail.use" aria-label={`${selected.name} 이 펫으로`} onClick={() => onSelect(selected)}>이 펫으로 <span aria-hidden="true">→</span></button>
        <details className="workspace-detail-more"><summary>일하는 방식 자세히</summary><p>{selected.after}</p><p>{selected.limit}</p><PetSkillSource entry={selected} /></details>
      </div>
    </div>
  </section>;
  const catalogVisible = view === 'catalog' || view === 'saved';
  return <div className="pet-workspace-v2" data-view={view} data-agent-scope={catalogVisible ? 'pet-selection' : undefined}>
    {view === 'home' && <PetHome active={active} connectedCount={disconnected ? 0 : links.filter(link => link.connected).length} onBrowse={onBrowse}>
      {recent.length > 0 && <section className="pet-home-resume" aria-label="이어서 할 일"><h2>이어서 할 일</h2><div className="pet-home-resume-grid">{recent.map(link => liveCard(link, true))}</div></section>}{legacy}
    </PetHome>}
    {view === 'pets' && <>
      <header className="workspace-heading"><h1>내 작업</h1><button className="button secondary" onClick={onBrowse}>새 일 맡기기 +</button></header>
      {links.length > 0 ? <section className="workspace-activity workspace-activity-grid" aria-label="연결된 작업">{groups.flatMap(([group, label]) => {
        const items = links.filter(link => groupFor(link, disconnected) === group);
        return items.length ? [<h2 id={`activity-${group}`} key={group}>{label}<span>{items.length}</span></h2>, ...items.map(link => liveCard(link))] : [];
      })}</section> : <div className="workspace-empty"><p>아직 맡긴 일이 없어요.</p><button className="text-button" onClick={onBrowse}>펫 고르기 →</button></div>}{legacy}
    </>}
    {catalogVisible && <>
      {selected ? detail : <>
        <header className="workspace-heading"><h1>펫 고르기</h1><div className="workspace-shelf-tabs" data-agent-id="pet-selection.shelf" role="group" aria-label="펫 보관함"><button aria-pressed={shelfTab === 'all'} onClick={() => setShelfTab('all')}>전체 펫</button><button aria-pressed={shelfTab === 'saved'} onClick={() => setShelfTab('saved')}>내 펫</button></div></header>
        {shelfTab === 'saved' ? <>
          <section className="pet-favorites workspace-favorites" aria-label="즐겨찾는 펫"><h2>즐겨찾기</h2>{favoriteEntries.length ? shelf(favoriteEntries, 'favorites') : <div className="workspace-empty"><p>마음에 드는 펫에 ☆를 눌러보세요.</p><button className="text-button" onClick={() => setShelfTab('all')}>펫 둘러보기 →</button></div>}</section>
          <section className="workspace-saved"><h2>저장한 구성</h2>{pets.length ? shelf(pets.map(pet => ({ id: `saved:${pet.id}`, pet, entry: undefined })), 'saved') : <p className="workspace-note">저장한 펫이 여기에 보여요.</p>}</section>
        </> : <section className="workspace-library" aria-label="할 일 고르기">
          <div className="workspace-library-heading"><div className="pet-category-tabs" data-agent-id="pet-selection.categories" role="group" aria-label="할 일 분류">{(['all', 'daily', 'work'] as const).map(id => <button key={id} aria-label={categoryNames[id]} aria-pressed={category === id} onClick={() => onCategory(id)}>{categoryNames[id]}</button>)}</div></div>
          <div className="workspace-role-grid">{petCatalog.filter(entry => category === 'all' || entry.category === category).map(entry => <article className="workspace-role-card" key={entry.id} data-role={entry.id} data-agent-id={`pet-selection.role.${entry.id}`}><FavoriteButton selected={favorites.includes(`template:${entry.id}`)} label={`${entry.name} 즐겨찾기`} onClick={() => onFavorite(`template:${entry.id}`)} /><button className="workspace-role-select" data-agent-id={`pet-selection.role.${entry.id}.choose`} aria-label={`${entry.name} 펫 선택`} onClick={() => choose(entry)}><span className="workspace-role-identity"><TaskPetArt entry={entry} small /><h3>{entry.name}</h3></span><ResultPreview entry={entry} compact /><PetSkillSource entry={entry} compact /><span className="workspace-role-action">살펴보기 <span aria-hidden="true">↗</span></span></button></article>)}</div>
        </section>}
      </>}
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
