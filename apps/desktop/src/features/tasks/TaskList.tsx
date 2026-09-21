import type { Session, Snapshot } from '@autopets/contracts/types';
import { isDesktop } from '../../bridge/command';
import { shortPath } from '../../app/shared/format';
import { Clock } from '../../app/shared/Clock';
import { PET_NAMES } from '../pets/constants';
import { dueAttention, status } from './presentation';

export type TaskFilter = 'all' | 'working' | 'attention' | 'arrived';
export function TaskList({ snapshot, disconnected, taskFilter, setTaskFilter, busy, onDetails, onConnect, onConnection }: { snapshot: Snapshot; disconnected: boolean; taskFilter: TaskFilter; setTaskFilter: (filter: TaskFilter) => void; busy: boolean; onDetails: (sessionId: string) => void; onConnect: (slot: number, sessionId: string) => void; onConnection: () => void }) {
  const assignedIds = snapshot.slots.map(slot => slot.sessionId);
  const orderedTasks = [...snapshot.sessions].sort((a, b) => b.lastSeen - a.lastSeen);
  const availableSlot = snapshot.slots.find(slot => slot.index >= 0 && slot.index < 3 && slot.sessionId === null);
  const matchesFilter = (session: Session, filter: typeof taskFilter) => filter === 'all'
    || filter === 'working' && !disconnected && session.connection === 'observed' && session.state === 'working'
    || filter === 'attention' && (disconnected || session.connection === 'unknown' || Boolean(dueAttention(session, snapshot.now)) || session.state === 'waiting' || session.state === 'failed')
    || filter === 'arrived' && session.state === 'done';
  const filters = [{ id: 'all', label: '전체' }, { id: 'working', label: '진행 중' }, { id: 'attention', label: '확인 필요' }, { id: 'arrived', label: '응답 도착' }] as const;
  const visibleTasks = orderedTasks.filter(session => matchesFilter(session, taskFilter));
  const unassignedCount = snapshot.sessions.filter(session => !assignedIds.includes(session.id)).length;
  return <section className="activity-section manager-tasks" aria-label="전체 작업 목록">
          <div className="section-title"><h2>모든 작업 <span>{snapshot.sessions.length}</span></h2><span className="muted">마지막으로 관측한 활동 기준</span></div>
          <div className="task-filters" role="group" aria-label="작업 상태 필터">{filters.map(filter => <button key={filter.id} type="button" className={`task-filter ${taskFilter === filter.id ? 'selected' : ''}`} aria-pressed={taskFilter === filter.id} data-testid={`task-filter-${filter.id}`} onClick={() => setTaskFilter(filter.id)}>{filter.label}<span>{orderedTasks.filter(session => matchesFilter(session, filter.id)).length}</span></button>)}</div>
          {unassignedCount > 0 && <p className="task-capacity-note">펫은 최대 3개까지 연결돼요. 펫에 연결되지 않은 {unassignedCount}개 작업도 이 목록에서 확인할 수 있어요.{!availableSlot && ' 다른 작업에 펫을 연결하려면 위에서 기존 연결을 먼저 해제해주세요.'}</p>}
          {!snapshot.sessions.length ? <div className="empty-tasks"><span className="empty-orbit" aria-hidden="true">✧</span><div><h3>첫 번째 작업을 기다리고 있어요</h3><p>훅을 연결한 Codex에서 활동이 전달되면 여기에 나타나요.</p></div><button className="button secondary" onClick={() => onConnection()}>연결 안내 →</button></div>
            : !visibleTasks.length ? <div className="task-filter-empty" role="status">{filters.find(filter => filter.id === taskFilter)?.label} 작업이 없어요.<button type="button" className="text-button" onClick={() => setTaskFilter('all')}>전체 작업 보기</button></div>
            : <div className="task-list manager-task-list">{visibleTasks.map(session => {
              const slot = snapshot.slots.find(slot => slot.sessionId === session.id);
              const view = status(session, snapshot.now, disconnected);
              return <div className="task-list-entry" key={session.id} data-session-id={session.id}>
                <button className="task-row" aria-label={`${session.label} 작업 상세`} onClick={() => onDetails(session.id)}><span className={`state-dot ${view.kind}`} /><span className="task-row-text"><strong>{session.label}</strong><span>{shortPath(session.cwd)}</span></span><span className="task-state">{view.text}</span><Clock stamp={session.lastSeen} /></button>
                <div className="task-binding">{slot ? <span className="task-pet-label">{PET_NAMES[slot.index]} 연결됨</span> : <><span className="task-pet-label unbound">목록에서 확인</span><button type="button" className="text-button" disabled={!isDesktop || !availableSlot || busy} title={!availableSlot ? '기존 펫 연결을 먼저 해제해주세요.' : '빈 펫에 이 작업을 연결해요.'} aria-label={`${session.label} 펫 연결`} onClick={() => { if (availableSlot) { onConnect(availableSlot.index, session.id); } }}>펫 연결</button></>}</div>
              </div>;
            })}</div>}
        </section>;
}
