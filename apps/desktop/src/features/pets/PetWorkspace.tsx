import { useEffect, useState, type ReactNode } from 'react';
import type { PetJob, PetLink, SavedPet } from '@autopets/contracts/types';
import { PetJobList } from './PetJobs';
import { SkillHub } from './SkillHub';
import { petCatalog, allPetCatalog, catalogFor, type PetCatalogEntry } from './petCatalog';
import { TaskPetArt } from './TaskPetArt';
import { FavoriteButton } from './PetIntroduction';
import { ExplicitPet } from './ExplicitPet';
import { PetCardThumb } from './PetCardThumb';
import { PetHome } from './PetHome';
import { PromptIdeaLibrary } from './PromptIdeaLibrary';

export type PetWorkspaceView = 'home' | 'pets' | 'catalog' | 'saved';
const groupFor = (link: PetLink, disconnected: boolean) => {
  if (disconnected || !link.connected || !link.enabled || link.run?.trackingClosed || ['waiting', 'returned', 'failed', 'unknown'].includes(link.run?.state ?? '')) return 'attention';
  if (['requested', 'working'].includes(link.run?.state ?? '')) return 'working';
  if (link.run?.state === 'complete') return 'complete';
  return 'ready';
};
const groups = [['attention', '확인이 필요해요'], ['working', '함께하고 있어요'], ['complete', '최근 결과'], ['ready', '준비된 펫']] as const;
const categoryNames = { all: '전체', daily: '일상', work: '업무' } as const;

export function PetWorkspace({ view, navigationRevision = 0, active, category, onCategory, links, disconnected, legacy, pets, favorites, onFavorite, onSelect, onSaved, onNewTask, onBrowse, error, jobs = [] }: {
  view: PetWorkspaceView; active: boolean; category: 'all' | 'daily' | 'work'; onCategory: (value: 'all' | 'daily' | 'work') => void;
  links: PetLink[]; disconnected: boolean; legacy?: ReactNode; pets: SavedPet[]; favorites: string[];
  onFavorite: (id: string) => void; onSelect: (entry: PetCatalogEntry, request?: string) => void; onSaved: (pet: SavedPet) => void; onNewTask: (link: PetLink) => void; onBrowse: () => void; error: string;
  navigationRevision?: number; jobs?: PetJob[];
}) {
  const [shelfTab, setShelfTab] = useState<'all' | 'saved'>(view === 'saved' ? 'saved' : 'all');
  const [ideasOpen, setIdeasOpen] = useState(false);
  useEffect(() => { if (view === 'saved') setShelfTab('saved'); }, [view, navigationRevision]);
  const favoriteEntries = favorites.map(id => ({ id, entry: allPetCatalog.find(entry => id === `template:${entry.id}`), pet: pets.find(pet => id === `saved:${pet.id}`) }));
  // The detail screen with the start button lives in UiPetStudio, so every entry point shares it.
  const choose = (entry: PetCatalogEntry) => onSelect(entry);
  const shelf = (items: typeof favoriteEntries, area: 'favorites' | 'saved') => <div className="workspace-saved-grid">{items.map(({ id, entry, pet }) => {
    const current = pet ? catalogFor(pet.template) : entry;
    return <article key={id} className="workspace-saved-card" data-role={current?.id} data-agent-id={`pet-selection.${area}.${id}`}><TaskPetArt entry={current} small /><div><h3>{pet?.template.name ?? entry?.template.name ?? '찾을 수 없는 펫'}</h3><p>{current?.output ?? '저장한 구성을 다시 확인해 주세요.'}</p><button className="text-button" disabled={!current} onClick={() => pet ? onSaved(pet) : entry && choose(entry)}>이 펫 부르기 →</button></div><FavoriteButton selected={favorites.includes(id)} label={`${pet?.template.name ?? entry?.template.name ?? '펫'} 즐겨찾기`} onClick={() => onFavorite(id)} /></article>;
  })}</div>;
  const liveCard = (link: PetLink, home = false) => <article className={`workspace-live-card pet-card-${link.slot}`} key={JSON.stringify(link.target)}><ExplicitPet link={link} disconnected={disconnected} compact showPet={!home} onNewTask={catalogFor(link.template) ? onNewTask : undefined} /></article>;
  const recent = groups.flatMap(([group]) => links.filter(link => groupFor(link, disconnected) === group)).slice(0, 3);
  const catalogVisible = view === 'catalog' || view === 'saved';
  return <div className="pet-workspace-v2" data-view={view} data-agent-scope={catalogVisible ? 'pet-selection' : undefined}>
    {view === 'home' && <PetHome active={active} connectedCount={disconnected ? 0 : links.filter(link => link.connected).length} onBrowse={onBrowse}>
      {recent.length > 0 && <section className="pet-home-resume" aria-label="이어서 할 일"><h2>이어서 할 일</h2><div className="pet-home-resume-grid">{recent.map(link => liveCard(link, true))}</div></section>}{legacy}
    </PetHome>}
    {view === 'pets' && <>
      <header className="workspace-heading"><h1>내 작업</h1><button className="button secondary" onClick={onBrowse}>새 일 맡기기 +</button></header>
      <PetJobList jobs={jobs} />
      {links.length > 0 ? <section className="workspace-activity workspace-activity-grid" aria-label="연결된 작업">{groups.flatMap(([group, label]) => {
        const items = links.filter(link => groupFor(link, disconnected) === group);
        return items.length ? [<h2 id={`activity-${group}`} key={group}>{label}<span>{items.length}</span></h2>, ...items.map(link => liveCard(link))] : [];
      })}</section> : jobs.length > 0 ? null : <div className="workspace-empty"><p>아직 맡긴 일이 없어요.</p><button className="text-button" onClick={onBrowse}>펫 고르기 →</button></div>}{legacy}
    </>}
    {catalogVisible && <>
        <header className="workspace-heading">
          <h1>펫 고르기</h1>
          <div className="workspace-shelf-tabs" data-agent-id="pet-selection.shelf" role="group" aria-label="펫 보관함">
            <button aria-pressed={shelfTab === 'all'} onClick={() => setShelfTab('all')}>둘러보기</button>
            <button aria-pressed={shelfTab === 'saved'} onClick={() => setShelfTab('saved')}>내 펫</button>
          </div>
        </header>
        {shelfTab === 'saved' ? <>
          <section className="pet-favorites workspace-favorites" aria-label="즐겨찾는 펫"><h2>즐겨찾기</h2>{favoriteEntries.length ? shelf(favoriteEntries, 'favorites') : <div className="workspace-empty"><p>마음에 드는 펫에 ☆를 눌러보세요.</p><button className="text-button" onClick={() => setShelfTab('all')}>펫 둘러보기 →</button></div>}</section>
          <section className="workspace-saved"><h2>저장한 구성</h2>{pets.length ? shelf(pets.map(pet => ({ id: `saved:${pet.id}`, pet, entry: undefined })), 'saved') : <p className="workspace-note">저장한 펫이 여기에 보여요.</p>}</section>
        </> : <>
          <section className="workspace-library" aria-label="할 일 고르기">
            <div className="workspace-library-heading">
              <div className="pet-category-tabs" data-agent-id="pet-selection.categories" role="group" aria-label="할 일 분류">
                {(['all', 'daily', 'work'] as const).map(id => <button key={id} aria-pressed={category === id} onClick={() => onCategory(id)}>{categoryNames[id]}</button>)}
              </div>
            </div>
            <div className="workspace-role-grid">
              {petCatalog.filter(entry => category === 'all' || entry.category === category).map(entry => (
                <article className="workspace-role-card" key={entry.id} data-role={entry.id} data-agent-id={`pet-selection.role.${entry.id}`}>
                  <FavoriteButton selected={favorites.includes(`template:${entry.id}`)} label={`${entry.name} 즐겨찾기`} onClick={() => onFavorite(`template:${entry.id}`)} />
                  <button className="workspace-role-select" data-agent-id={`pet-selection.role.${entry.id}.choose`} aria-label={`${entry.name} 펫 선택`} onClick={() => choose(entry)}>
                    <span className="workspace-role-identity">
                      <span className="workspace-pet-portrait">
                        <TaskPetArt entry={entry} interactive={false} />
                      </span>
                      <span className="workspace-role-text">
                        <strong>{entry.name} <span aria-hidden="true">→</span></strong>
                        <span>{entry.summary}</span>
                      </span>
                    </span>
                    <PetCardThumb entry={entry} />
                  </button>
                </article>
              ))}
            </div>
          </section>
          <section className="workspace-resources" aria-label="더 둘러보기">
            <details className="pet-disclosure">
              <summary>함께 쓰는 AI 도구</summary>
              <SkillHub />
            </details>
            <details className="pet-disclosure" open={ideasOpen} onToggle={event => setIdeasOpen(event.currentTarget.open)}>
              <summary>이미지·영상 아이디어</summary>
              {ideasOpen && <PromptIdeaLibrary active={active} onSelect={onSelect} />}
            </details>
          </section>
        </>}
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
