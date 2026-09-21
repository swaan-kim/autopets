import { command, isDesktop } from '../bridge/command';
import { useSnapshot } from '../bridge/useSnapshot';
import { useAssistance } from '../bridge/useAssistance';
import { PetOverlay } from '../features/pets/PetOverlay';
import { Manager } from './Manager';
import { petIndex } from './windowRoute';

export function App() {
  const { snapshot, error } = useSnapshot();
  const assistance = useAssistance();
  if (!snapshot) return <div className="loading-state" role="status">{error ? `브리지 연결 확인 필요 · ${error}` : '로컬 작업 상태를 불러오는 중…'}{isDesktop && <button className="button secondary" onClick={() => void command('quit_app')}>AutoPets 종료</button>}</div>;
  return petIndex === null ? <Manager snapshot={snapshot} error={error} assistance={assistance} /> : <PetOverlay snapshot={snapshot} index={petIndex} error={error} assistance={assistance} />;
}
