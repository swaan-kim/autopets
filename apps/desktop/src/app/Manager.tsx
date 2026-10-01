import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { ChatIdentity, Snapshot, TaskConfiguration } from '@autopets/contracts/types';
import { isDesktop } from '../bridge/command';
import { useAction } from '../bridge/useAction';
import { useAssistance } from '../bridge/useAssistance';
import type { useWorkflow } from '../bridge/useWorkflow';
import { PetGrid } from '../features/pets/PetGrid';
import { PET_NAMES } from '../features/pets/constants';
import { AssistancePanel } from '../features/assistance/AssistancePanel';
import { ConfigurationForm } from '../features/tasks/ConfigurationForm';
import { TaskDetails } from '../features/tasks/TaskDetails';
import { formatTime, shortPath } from './shared/format';
import { Modal } from './shared/Modal';
import { AppShell, type ManagerSection } from './AppShell';
import { IntroStudio } from '../features/intro/IntroStudio';
import { ConnectionGuide } from '../features/onboarding/ConnectionGuide';
import { TaskList } from '../features/tasks/TaskList';
import { WORKFLOW_PRESETS } from '../features/workflow/presentation';
import { RoleStudio } from '../features/roles/RoleStudio';
import { UiPetStudio } from '../features/pets/UiPetStudio';

export function Manager({ snapshot, error, assistance, workflow }: { snapshot: Snapshot; error: string; assistance: ReturnType<typeof useAssistance>; workflow: ReturnType<typeof useWorkflow> }) {
  const [settings, setSettings] = useState<ManagerSection>('pets');
  const [assistanceSession, setAssistanceSession] = useState<string | null>(null);
  const [assistanceIdentity, setAssistanceIdentity] = useState<ChatIdentity | null>(null);
  const [assistanceRequest, setAssistanceRequest] = useState(0);
  useEffect(() => {
    if (!isDesktop) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ sessionId?: string }>('autopets://open-assistance', event => { setAssistanceIdentity(null); setAssistanceSession(event.payload.sessionId || null); setAssistanceRequest(value => value + 1); setSettings('assistance'); }).then(dispose => { if (disposed) dispose(); else unlisten = dispose; }).catch(() => { /* Snapshot controls remain usable if the window event listener is unavailable. */ });
    return () => { disposed = true; unlisten?.(); };
  }, []);
  const [picker, setPicker] = useState<number | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<'all' | 'working' | 'attention' | 'arrived'>('all');
  const action = useAction();
  const assignedIds = snapshot.slots.map(slot => slot.sessionId);
  const bound = assignedIds.filter(Boolean).length + (snapshot.petLinks?.length ?? 0);
  const [preparingPet, setPreparingPet] = useState(bound === 0);
  const disconnected = Boolean(error) || (isDesktop && !snapshot.connectionPath);
  const sessions = [...snapshot.sessions].filter(session => `${session.label} ${session.cwd} ${session.id}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.lastSeen - a.lastSeen);
  const pickedSession = snapshot.sessions.find(session => session.id === pickedId);
  const editSession = snapshot.sessions.find(session => session.id === editId);
  const detailSession = snapshot.sessions.find(session => session.id === detailId);
  const configure = async (sessionId: string, config: TaskConfiguration) => action.run('configure_session', { sessionId, ...config });
  const closePicker = () => { if (!action.busy) { setPicker(null); setPickedId(null); } };
  return <AppShell settings={settings} bound={bound} disconnected={disconnected} busy={action.busy} error={error || action.error} onNavigate={setSettings} onQuit={() => void action.run('quit_app')} dialogs={<>

    {picker !== null && <Modal title={pickedSession ? `${PET_NAMES[picker]}에게 작업 맡기기` : '연결할 작업을 골라주세요'} close={closePicker}>{action.error && <p className="error" role="alert">{action.error}</p>}{pickedSession ? <><button className="text-button" disabled={action.busy} onClick={() => setPickedId(null)}>← 다른 작업 선택</button><ConfigurationForm key={pickedSession.id} session={pickedSession} busy={action.busy} submitLabel="이 작업 연결하기" onSave={async config => { if (await configure(pickedSession.id, config) && await action.run('assign_session', { slot: picker, sessionId: pickedSession.id })) { setPicker(null); setPickedId(null); } }} /></> : <><input className="search-input" aria-label="작업 검색" placeholder="작업 이름, 경로 또는 ID 검색" value={query} onChange={event => setQuery(event.target.value)} /><div className="picker-list">{!sessions.length ? <p className="picker-empty">표시할 작업이 없어요.<br />연결한 Codex에서 활동을 시작해주세요.</p> : sessions.map(session => <button className="picker-row" key={session.id} disabled={assignedIds.includes(session.id)} onClick={() => setPickedId(session.id)}><span><strong>{session.label}</strong><small>{session.cwd}</small><small>{session.id} · {formatTime(session.lastSeen)}</small></span><span>{assignedIds.includes(session.id) ? '연결됨' : '＋'}</span></button>)}</div></>}</Modal>}
    {editSession && <Modal title="작업 설정" close={() => { if (!action.busy) setEditId(null); }}>{action.error && <p className="error" role="alert">{action.error}</p>}<ConfigurationForm key={editSession.id} session={editSession} busy={action.busy} submitLabel="설정 저장" onSave={async config => { if (await configure(editSession.id, config)) setEditId(null); }} /></Modal>}
    {detailSession && <Modal title={detailSession.label} close={() => setDetailId(null)} wide><p className="overlay-path">{shortPath(detailSession.cwd)}</p><TaskDetails session={detailSession} now={snapshot.now} disconnected={disconnected} /></Modal>}
  </>}>
      {settings === 'roles' ? <RoleStudio workflow={workflow.snapshot} sessions={snapshot.sessions} refreshWorkflow={workflow.refresh} /> : settings === 'intro' ? <IntroStudio assistance={assistance.snapshot} workflow={workflow.snapshot} sessions={snapshot.sessions} onWorkflow={identity => { setAssistanceIdentity(identity); setAssistanceSession(identity.chatId); setAssistanceRequest(value => value + 1); setSettings('assistance'); }} /> : settings === 'assistance' ? <AssistancePanel key={assistanceRequest} snapshot={assistance.snapshot} sessions={snapshot.sessions} initialSessionId={assistanceSession} initialIdentity={assistanceIdentity} error={assistance.error} loaded={assistance.loaded} refresh={assistance.refresh} workflow={workflow} /> : settings === 'connection' ? <ConnectionGuide petLinks={snapshot.petLinks} setup={snapshot.setup} connectionPath={snapshot.connectionPath} defaultLabel={WORKFLOW_PRESETS.find(item => item.id === workflow.snapshot.preferences.preset)?.title} onBack={() => setSettings('pets')} onPreferences={() => setSettings('assistance')} /> : null}
      <div className={`pets-workspace ${preparingPet ? 'preparing-pet' : ''}`} hidden={settings !== 'pets'}>
        <div className="pets-dashboard" hidden={preparingPet}>
        {bound > 0 && <><div className="page-heading pets-page-heading"><span className="eyebrow">함께하는 작업</span><h1>펫과 이어서 해볼까요?</h1><p>지금 필요한 확인부터, 끝난 작업의 결과까지.</p></div><div className="section-title"><h2>연결한 펫 <span>{bound} / 3</span></h2><button className="text-button" disabled={!isDesktop} onClick={() => void action.run('set_pets_visible', { visible: true })}>바탕화면에 모두 표시 ↗</button></div></>}
        {bound > 0 && <PetGrid snapshot={snapshot} disconnected={disconnected} busy={action.busy} onDetails={setDetailId} onEdit={setEditId} onUnassign={slot => void action.run('unassign_session', { slot })} onOpen={slot => void action.run('open_pet', { slot })} onConnect={slot => { setPicker(slot); setQuery(''); setPickedId(null); }} />}
        </div>
        <UiPetStudio active={settings === 'pets'} initiallyOpen={bound === 0} onOpenChange={setPreparingPet} links={snapshot.petLinks ?? []} setup={snapshot.setup} onConnection={() => setSettings('connection')} />
        <div hidden={preparingPet}>{(snapshot.sessions.length > 0) && <TaskList snapshot={snapshot} disconnected={disconnected} taskFilter={taskFilter} setTaskFilter={setTaskFilter} busy={action.busy} onDetails={setDetailId} onConnect={(slot, sessionId) => { setPicker(slot); setQuery(''); setPickedId(sessionId); }} onConnection={() => setSettings('connection')} />}<footer className="workspace-footer"><span>작업과 결과는 Codex 채팅에 그대로 있어요.</span><span className="footer-mode">AutoPets</span></footer></div>
      </div>
  </AppShell>;
}
