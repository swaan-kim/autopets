import { command, isDesktop } from '../bridge/command';
import { useSnapshot } from '../bridge/useSnapshot';
import { useAssistance } from '../bridge/useAssistance';
import { useWorkflow } from '../bridge/useWorkflow';
import { PetOverlay } from '../features/pets/PetOverlay';
import { Manager } from './Manager';
import { petIndex } from './windowRoute';

export function App() {
  const { snapshot, error } = useSnapshot();
  const assistance = useAssistance();
  const workflow = useWorkflow();
  if (!snapshot) return <div className="loading-state" role="status">{error ? <div><p>AutoPets를 시작하지 못했어요. 앱을 종료한 뒤 다시 열어 주세요.</p><details><summary>오류 내용</summary><p>{error}</p></details></div> : '불러오는 중…'}{isDesktop && <button className="button secondary" onClick={() => void command('quit_app')}>AutoPets 종료</button>}</div>;
  return petIndex === null ? <Manager snapshot={snapshot} error={error} assistance={assistance} workflow={workflow} /> : <PetOverlay snapshot={snapshot} index={petIndex} error={error} assistance={assistance} workflow={workflow} />;
}
