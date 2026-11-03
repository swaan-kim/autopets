import { Agentation } from 'agentation';
import { useEffect } from 'react';

export default function Feedback() {
  useEffect(() => {
    // A click on a label/image must retain its nearest assigned area, too.
    const stamp = (root: Element) => {
      for (const element of [root, ...root.querySelectorAll('*')]) {
        const scope = element.closest<HTMLElement>('[data-agent-scope]')?.dataset.agentScope;
        if (scope && ['home', 'pet-selection', 'task-card'].includes(scope)) element.setAttribute('data-agent-review-owner', scope);
        else element.removeAttribute('data-agent-review-owner');
      }
    };
    stamp(document.body);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes' && record.target instanceof Element) stamp(record.target);
        else for (const node of record.addedNodes) if (node instanceof Element) stamp(node);
      }
    });
    observer.observe(document.body, {childList:true,subtree:true,attributes:true,attributeFilter:['data-agent-scope']});
    return () => { observer.disconnect();document.querySelectorAll('[data-agent-review-owner]').forEach(element=>element.removeAttribute('data-agent-review-owner')); };
  }, []);
  const endpoint = import.meta.env.VITE_AGENTATION_ENDPOINT || 'http://127.0.0.1:4747';
  let local = false;
  try {
    const url = new URL(endpoint);
    local = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  } catch { /* Invalid development configuration never sends page context elsewhere. */ }
  if (!local) return null;
  return <div data-agentation-development="true">
    <aside data-feedback-toolbar="true" style={{position:'fixed',bottom:20,left:20,zIndex:2147483000,display:'flex',gap:12,alignItems:'center',padding:'10px 14px',border:'1px solid #ddd',borderRadius:12,background:'#fff',color:'#555',fontSize:12,maxWidth:'calc(100vw - 100px)',flexWrap:'wrap'}}>
      <span>{location.pathname === '/__review__/tasks' ? '검수용 예시 · 실제 작업 실행 없음' : '개발 화면 검수'}</span>
      <a href="/" style={{color:'#333'}}>홈·펫 선택</a>
      <a href="/__review__/tasks" style={{color:'#333'}}>작업 카드 예시</a>
    </aside>
    <Agentation appName="AutoPets 개발 검수" endpoint={endpoint} copyToClipboard={false}
      enableKeyboardShortcuts={false} identifyingAttributes={['data-agent-scope', 'data-agent-id', 'data-agent-review-owner', 'data-testid']} />
  </div>;
}
