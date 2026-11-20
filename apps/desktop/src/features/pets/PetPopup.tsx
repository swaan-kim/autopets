import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PetLink } from '@autopets/contracts/types';
import { command } from '../../bridge/command';
import { useAction } from '../../bridge/useAction';
import { explicitPetStatus, unresolvedPetRun } from './ExplicitPet';
import { petTaskReturnLabel, usePetTaskReturn } from './PetTaskReturn';
import { chatTitle, useCodexChatTitles } from './useCodexChatTitles';
import './pet-popup.css';

// The small popup above a desktop pet that is linked to a Codex chat. It only answers
// "which chat, what state, what next". Evidence, the task name, help on/off, unlinking and
// tracking cleanup stay on the app's task card (ExplicitPet).
type Profile = PetLink['profile'];
const profileLabels: Record<Profile, string> = { light: '가볍게', standard: '표준', careful: '꼼꼼하게', plan: '계획만' };
const choices: Profile[] = ['light', 'standard', 'careful'];

const icons: Record<'chat' | 'app' | 'hide' | 'quit', ReactNode> = {
  chat: <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17h-8l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5Z" />,
  app: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M3.5 9.5h17" /></>,
  hide: <><path d="M3 12s3.3-6 9-6c1.6 0 3 .5 4.2 1.2M21 12s-3.3 6-9 6c-1.6 0-3-.5-4.2-1.2" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /><path d="M4 4l16 16" /></>,
  quit: <><path d="M12 3.5v8" /><path d="M7.2 6.6a7 7 0 1 0 9.6 0" /></>,
};
const Icon = ({ name }: { name: keyof typeof icons }) => <svg className="pet-popup-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{icons[name]}</svg>;

export function PetPopup({ link, disconnected = false, onHide }: { link: PetLink; disconnected?: boolean; onHide: () => void }) {
  const action = useAction();
  const titles = useCodexChatTitles([link.target.threadId]);
  const back = usePetTaskReturn(link, chatTitle(titles, link.target.threadId));
  const [choosing, setChoosing] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const changeButton = useRef<HTMLButtonElement>(null);
  const cancelQuit = useRef<HTMLButtonElement>(null);
  const quitButton = useRef<HTMLButtonElement>(null);
  const choiceGroup = useRef<HTMLDivElement>(null);
  const refocus = useRef<'change' | 'quit' | null>(null);

  const lost = disconnected || !link.connected;
  const unresolved = unresolvedPetRun(link);
  const active = !lost && !link.run?.trackingClosed && (link.enabled || Boolean(link.run));
  const state = active ? link.run?.state : undefined;
  const taskFolder = link.target.cwd.split(/[\\/]/).filter(Boolean).pop() || link.target.cwd;
  const heading = chatTitle(titles, link.target.threadId) ?? taskFolder;
  const status = explicitPetStatus(link, disconnected);
  const returnLabel = lost ? '다시 연결' : petTaskReturnLabel(link, disconnected);
  const profileLocked = action.busy || disconnected || unresolved;

  // Only states where the user has something to do get a line; the rest stay quiet.
  const guide = lost
    ? back.opened ? '채팅에 ‘펫 상태 확인’을 보내면 다시 이어져요.' : '“다시 연결”을 누르면 채팅을 열고 다시 이어요.'
    : link.run?.trackingClosed ? ''
    : !link.enabled ? '새 펫 작업은 꺼져 있어요. 이미 시작한 작업은 계속 확인해요.'
    : state === 'waiting' ? 'Codex에서 계획을 확인하고 “그대로 구현해줘”라고 보내 주세요.'
    : state === 'failed' || state === 'unknown' ? 'Codex 채팅에 ‘펫 상태 확인’이라고 보내 주세요.'
    : '';
  // The reconnect hint replaces the generic "opened" receipt; failures always show.
  const returnNotice = back.notice && !(lost && back.opened) ? back.notice : '';
  const actionError = action.error.includes('pet-revision-changed') ? '설정이 바뀌었어요. 현재 상태를 확인한 뒤 다시 선택해 주세요.'
    : action.error.includes('pet-run-active-or-unresolved') ? '현재 작업을 먼저 확인해 주세요.'
    : action.error ? '변경하지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.' : '';

  useEffect(() => { if (profileLocked) setChoosing(false); }, [profileLocked]);
  useEffect(() => { if (confirmQuit) cancelQuit.current?.focus({ preventScroll: true }); }, [confirmQuit]);
  useEffect(() => {
    if (choosing) (choiceGroup.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? choiceGroup.current?.querySelector('button'))?.focus({ preventScroll: true });
  }, [choosing]);
  useEffect(() => {
    if (refocus.current === 'change' && !choosing) changeButton.current?.focus({ preventScroll: true });
    if (refocus.current === 'quit' && !confirmQuit) quitButton.current?.focus({ preventScroll: true });
    refocus.current = null;
  }, [choosing, confirmQuit]);

  const choose = async (profile: Profile) => {
    refocus.current = 'change';
    if (profile === link.profile) { setChoosing(false); return; }
    if (await action.run('set_pet_link_profile', { target: link.target, expectedRevision: link.revision, profile })) setChoosing(false);
  };

  return <section className="pet-popup" aria-label={`${heading} 펫 카드`} data-connection={lost ? 'lost' : 'connected'}
    data-agent-scope="task-card" data-agent-id="task-card.root" data-agent-item={`slot-${link.slot}`}>
    <header className="pet-popup-head">
      <span className="pet-popup-dot" aria-hidden="true" />
      <div className="pet-popup-title">
        <strong title={heading}>{heading}</strong>
        <p className="pet-popup-status" role="status" title={`${link.template.name} · ${status}`}>{link.template.name} · {status}</p>
      </div>
    </header>
    {guide && <p className={`pet-popup-guide${lost ? ' lost' : ''}`}>{guide}</p>}
    {returnNotice && <p className="pet-popup-notice" role={back.failed ? 'alert' : 'status'}>{returnNotice}</p>}
    {(!back.supported || back.failed) && <div className="pet-popup-fallback">
      {!back.supported && <p>지금은 바로 열 수 없어요. Codex에서 ‘{back.findName}’ 채팅을 찾아 주세요.</p>}
      <button className="pet-popup-text" onClick={() => void back.copy()}>채팅 이름 복사</button>
      {back.copyNotice && <p role="status">{back.copyNotice}</p>}
    </div>}
    {confirmQuit
      ? <div className="pet-popup-confirm" role="group" aria-label="AutoPets 종료 확인">
        <p>AutoPets를 끌까요?</p>
        <div>
          <button className="pet-popup-pill danger" data-agent-id="task-card.quit-confirm" aria-label="AutoPets 끄기" disabled={action.busy} onClick={() => void action.run('quit_app')}>끄기</button>
          <button ref={cancelQuit} className="pet-popup-pill" data-agent-id="task-card.quit-cancel" aria-label="종료 취소" onClick={() => { refocus.current = 'quit'; setConfirmQuit(false); }}>취소</button>
        </div>
      </div>
      : <div className="pet-popup-actions">
        <button className="pet-popup-action primary" data-agent-id="task-card.open-chat" aria-label={back.busy ? '채팅 여는 중' : returnLabel} disabled={back.busy || !back.supported} onClick={() => void back.open()}>
          <span className="pet-popup-circle"><Icon name="chat" /></span><span className="pet-popup-label">{back.busy ? '여는 중…' : returnLabel}</span>
        </button>
        <button className="pet-popup-action" data-agent-id="task-card.open-app" aria-label="앱 열기" onClick={() => void command('show_manager')}>
          <span className="pet-popup-circle"><Icon name="app" /></span><span className="pet-popup-label">앱 열기</span>
        </button>
        <button className="pet-popup-action" data-agent-id="task-card.hide" aria-label="펫 숨기기" onClick={onHide}>
          <span className="pet-popup-circle"><Icon name="hide" /></span><span className="pet-popup-label">숨기기</span>
        </button>
        <button ref={quitButton} className="pet-popup-action danger" data-agent-id="task-card.quit" aria-label="AutoPets 종료" onClick={() => setConfirmQuit(true)}>
          <span className="pet-popup-circle"><Icon name="quit" /></span><span className="pet-popup-label">종료</span>
        </button>
      </div>}
    <div className="pet-popup-profile" data-agent-id="task-card.profile">
      {choosing
        ? <>
          <span>작업 방식</span>
          <div ref={choiceGroup} className="pet-popup-choices" role="radiogroup" aria-label="작업 방식">
            {choices.map(value => <button key={value} role="radio" aria-checked={link.profile === value} aria-label={`작업 방식 ${profileLabels[value]}`} disabled={profileLocked} onClick={() => void choose(value)}>{profileLabels[value]}</button>)}
          </div>
        </>
        : <>
          <span>작업 방식 · <strong>{profileLabels[link.profile]}</strong></span>
          <button ref={changeButton} className="pet-popup-text" aria-label="작업 방식 바꾸기" disabled={profileLocked} onClick={() => setChoosing(true)}>바꾸기</button>
        </>}
    </div>
    {actionError && <p className="pet-popup-error" role="alert">{actionError}</p>}
  </section>;
}
