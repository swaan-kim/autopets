import { useCallback, useEffect, useRef, useState } from 'react';
import type { PetCustomView } from '@autopets/contracts/types';
import config from '../../../../../packages/contracts/data/pet-custom.json';
import { command } from '../../bridge/command';
import { PET_NAMES } from './constants';
import { ItemIcon, PetDressed } from './petCustomArt';
import './pet-custom.css';

export type PetCustomScreen = 'hub' | 'evolution' | 'decorate';
type Item = (typeof config.items)[number];
type Stage = (typeof config.stages)[number];
const petName = PET_NAMES[0];
const items = config.items;
const growth = config.stages.filter(stage => stage.group === 'growth');
const branch = config.stages.filter(stage => stage.group === 'branch');
const no = (value: number) => `No.${String(value).padStart(2, '0')}`;

/** Loads the decoration state from the app and changes it there; the app is the only writer. */
export function usePetCustom(refresh: string) {
  const [view, setView] = useState<PetCustomView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    let live = true;
    command<PetCustomView>('pet_custom_snapshot').then(next => { if (live) { setView(next); setError(''); } }).catch(() => { if (live) setView(null); });
    return () => { live = false; };
  }, [refresh]);
  const change = useCallback(async (name: string, args: Record<string, unknown>) => {
    // A second press while the first is on its way is dropped here; the app also refuses a repeat purchase.
    if (pending.current) return false;
    pending.current = true; setBusy(true);
    try { setView(await command<PetCustomView>(name, args)); setError(''); return true; }
    catch (reason) { setError(String(reason).includes('not-enough-coins') ? '코인이 모자라요.' : '다시 시도해 주세요.'); return false; }
    finally { pending.current = false; setBusy(false); }
  }, []);
  return { view, error, busy, buy: (itemId: string) => change('pet_custom_buy', { itemId }), wear: (itemId: string, wear: boolean) => change('pet_custom_wear', { itemId, wear }) };
}
type Custom = ReturnType<typeof usePetCustom>;

function Coins({ value }: { value: number }) {
  return <span className="pet-coin-count" aria-label={`코인 ${value}개`}><span className="pet-coin" aria-hidden="true" />{value}</span>;
}
function nextGoal(completed: number) {
  const next = growth.find(stage => (stage.completed ?? 0) > completed);
  const goal = next?.completed ?? growth[growth.length - 1].completed ?? 0;
  return { done: Math.min(completed, goal), goal };
}
function Progress({ completed }: { completed: number }) {
  const { done, goal } = nextGoal(completed);
  return <span className="pet-custom-progress"><span>다음 모습까지 {done} / {goal}</span><span className="pet-custom-bar" role="progressbar" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={done}><span style={{ width: `${goal ? done / goal * 100 : 100}%` }} /></span></span>;
}
const found = (view: PetCustomView) => config.stages.filter(stage => view.unlocked.includes(stage.no)).length;

/** The one button on 내 펫 that opens 펫 커스텀. */
export function PetCustomButton({ custom, onOpen }: { custom: Custom; onOpen: () => void }) {
  if (!custom.view) return null;
  return <button className="pet-custom-open" data-agent-id="pet-selection.custom.open" onClick={onOpen}>
    <PetDressed worn={custom.view.worn} slots={items} size={44} /><strong>펫 커스텀 →</strong>
  </button>;
}

/** ① 펫 커스텀: coins and the two cards, opened from 내 펫. */
export function PetCustomEntry({ custom, onOpen }: { custom: Custom; onOpen: (screen: PetCustomScreen) => void }) {
  const { view } = custom;
  if (!view) return null;
  const owned = items.filter(item => view.owned.includes(item.id));
  return <section className="pet-custom-entry" aria-label="내 펫 꾸미기" data-agent-id="pet-selection.custom">
    <div className="pet-custom-identity">
      <PetDressed worn={view.worn} slots={items} size={64} />
      <div><h2>{petName}</h2><p>작업 {view.completed}번을 함께했어요</p></div>
      <Coins value={view.coins} />
    </div>
    <div className="pet-custom-cards">
      <button className="pet-custom-card" data-agent-id="pet-selection.custom.evolution" onClick={() => onOpen('evolution')}>
        <strong>진화 →</strong>
        <Progress completed={view.completed} />
        <span className="pet-custom-chain" aria-hidden="true"><PetDressed slots={items} size={40} /><span>→</span><span className="pet-custom-unknown">?</span><span>→</span><span className="pet-custom-unknown">?</span></span>
        <span className="pet-custom-muted">도감 {found(view)} / {config.stages.length}</span>
      </button>
      <button className="pet-custom-card" data-agent-id="pet-selection.custom.decorate" onClick={() => onOpen('decorate')}>
        <strong>꾸미기 →</strong>
        <span>내 아이템 {owned.length}개</span>
        <span className="pet-custom-chain" aria-hidden="true">{owned.slice(0, 4).map(item => <span className="pet-custom-item-chip" key={item.id}><ItemIcon id={item.id} /></span>)}</span>
      </button>
    </div>
  </section>;
}

function StageCell({ stage, view }: { stage: Stage; view: PetCustomView }) {
  const open = view.unlocked.includes(stage.no);
  const drawn = open && stage.art;
  const name = drawn ? stage.name : open ? '곧 만나요' : '???';
  return <li className={`pet-custom-stage${drawn ? ' is-found' : ''}`} data-agent-id={`pet-selection.custom.stage.${stage.no}`} data-open={open}>
    <span className="pet-custom-stage-art">{drawn ? <PetDressed slots={items} size={72} /> : <><PetDressed slots={items} size={72} silhouette /><span className="pet-custom-stage-mark">?</span></>}</span>
    <span className="pet-custom-muted">{no(stage.no)}</span>
    <strong>{name}</strong>
    {!drawn && <span className="pet-custom-muted">{stage.condition}</span>}
  </li>;
}

/** ② Evolution: the current look and the eight-stage collection. */
function Evolution({ view }: { view: PetCustomView }) {
  const current = [...config.stages].reverse().find(stage => stage.art && view.unlocked.includes(stage.no)) ?? config.stages[0];
  return <div className="pet-custom-layout">
    <aside className="pet-custom-showcase">
      <PetDressed slots={items} size={180} />
      <h2>{petName}</h2>
      <p className="pet-custom-muted">{no(current.no)} · {current.name}</p>
      <Progress completed={view.completed} />
    </aside>
    <section className="pet-custom-panel" aria-label="도감">
      <h2>도감 {found(view)} / {config.stages.length} 발견</h2>
      <h3>쓸수록 자라요</h3>
      <ul className="pet-custom-stages">{growth.map(stage => <StageCell key={stage.no} stage={stage} view={view} />)}</ul>
      <h3>많이 쓴 펫에 따라 달라져요</h3>
      <ul className="pet-custom-stages">{branch.map(stage => <StageCell key={stage.no} stage={stage} view={view} />)}</ul>
    </section>
  </div>;
}

/** ③④ Decorate: wear owned items, or try on and buy new ones. */
function Decorate({ custom }: { custom: Custom }) {
  const view = custom.view!;
  const [tab, setTab] = useState<'mine' | 'buy'>('mine');
  const [slot, setSlot] = useState('all');
  const [trying, setTrying] = useState<Item | null>(null);
  const inSlot = (item: Item) => slot === 'all' || item.slot === slot;
  const owned = items.filter(item => view.owned.includes(item.id) && inSlot(item));
  const forSale = items.filter(item => !view.owned.includes(item.id) && inSlot(item));
  const worn = trying ? { ...view.worn, [trying.slot]: trying.id } : view.worn;
  const showTab = (next: 'mine' | 'buy') => { setTab(next); setTrying(null); };
  const toggle = (item: Item) => void custom.wear(item.id, view.worn[item.slot] !== item.id);
  const buy = async (item: Item) => { if (await custom.buy(item.id)) setTrying(null); };
  return <div className="pet-custom-layout">
    <aside className="pet-custom-showcase" data-agent-id="pet-selection.custom.preview">
      {trying && <span className="pet-custom-trying">입어보는 중</span>}
      <PetDressed worn={worn} slots={items} size={180} />
      {trying ? <>
        <h2>{trying.name}</h2>
        <button className="button primary pet-custom-buy" data-agent-id="pet-selection.custom.buy" disabled={custom.busy || view.coins < trying.price} onClick={() => void buy(trying)}>구매 <span className="pet-coin" aria-hidden="true" />{trying.price}</button>
        <button className="text-button pet-custom-revert" data-agent-id="pet-selection.custom.revert" onClick={() => setTrying(null)}>되돌리기</button>
      </> : <>
        <h2>{petName}</h2>
        {tab === 'mine' && <p className="pet-custom-muted">누르면 바로 입어요</p>}
      </>}
      {custom.error && <p className="error" role="alert">{custom.error}</p>}
    </aside>
    <section className="pet-custom-panel">
      <div className="pet-custom-toolbar">
        <div className="workspace-shelf-tabs" role="group" aria-label="꾸미기" data-agent-id="pet-selection.custom.tabs">
          <button aria-pressed={tab === 'mine'} data-agent-id="pet-selection.custom.tab.mine" onClick={() => showTab('mine')}>내 아이템</button>
          <button aria-pressed={tab === 'buy'} data-agent-id="pet-selection.custom.tab.buy" onClick={() => showTab('buy')}>구매</button>
        </div>
        <Coins value={view.coins} />
      </div>
      <div className="pet-custom-slots" role="group" aria-label="아이템 분류" data-agent-id="pet-selection.custom.slots">
        {[{ id: 'all', name: '전체' }, ...config.slots].map(item => <button key={item.id} aria-pressed={slot === item.id} data-agent-id={`pet-selection.custom.slot.${item.id}`} onClick={() => setSlot(item.id)}>{item.name}</button>)}
      </div>
      {tab === 'mine' ? <ul className="pet-custom-items">
        {owned.map(item => {
          const on = view.worn[item.slot] === item.id;
          return <li key={item.id}><button className={`pet-custom-item${on ? ' is-worn' : ''}`} aria-pressed={on} data-agent-id={`pet-selection.custom.item.${item.id}`} disabled={custom.busy} onClick={() => toggle(item)}>
            <ItemIcon id={item.id} /><span>{item.name}</span>{on && <span className="pet-custom-worn">착용 중</span>}
          </button></li>;
        })}
        <li><button className="pet-custom-item is-shop" data-agent-id="pet-selection.custom.to-shop" onClick={() => showTab('buy')}>+ 구매하러 가기</button></li>
      </ul> : <>
        <ul className="pet-custom-items">
          {forSale.map(item => <li key={item.id}><button className={`pet-custom-item${trying?.id === item.id ? ' is-trying' : ''}`} aria-pressed={trying?.id === item.id} data-agent-id={`pet-selection.custom.item.${item.id}`} onClick={() => setTrying(item)}>
            <ItemIcon id={item.id} /><span>{item.name}</span><span className={`pet-custom-price${view.coins < item.price ? ' is-short' : ''}`}><span className="pet-coin" aria-hidden="true" />{item.price}</span>
          </button></li>)}
        </ul>
        <h3>도전으로만 받아요</h3>
        <ul className="pet-custom-items" data-agent-id="pet-selection.custom.challenges">
          {config.challenges.map(label => <li key={label}><span className="pet-custom-item is-locked"><span className="pet-custom-unknown">?</span><span>{label}</span></span></li>)}
        </ul>
        <p className="pet-custom-muted pet-custom-earn"><span className="pet-coin" aria-hidden="true" /> 작업을 끝낼 때마다 모여요</p>
      </>}
    </section>
  </div>;
}

/** 펫 커스텀 (①) and its two screens (②, ③④). Each screen goes back one step. */
export function PetCustomPage({ screen, custom, onNavigate }: { screen: PetCustomScreen; custom: Custom; onNavigate: (screen: PetCustomScreen | null) => void }) {
  if (!custom.view) return null;
  const label = { hub: '펫 커스텀', evolution: '진화', decorate: '꾸미기' }[screen];
  return <section className="pet-custom-page" data-screen={screen} aria-label={label} data-agent-id={`pet-selection.custom.${screen}-page`}>
    <button className="text-button workspace-detail-back" data-agent-id="pet-selection.custom.back" onClick={() => onNavigate(screen === 'hub' ? null : 'hub')}>{screen === 'hub' ? '← 내 펫' : '← 펫 커스텀'}</button>
    {screen === 'hub' ? <PetCustomEntry custom={custom} onOpen={onNavigate} /> : screen === 'evolution' ? <Evolution view={custom.view} /> : <Decorate custom={custom} />}
  </section>;
}
