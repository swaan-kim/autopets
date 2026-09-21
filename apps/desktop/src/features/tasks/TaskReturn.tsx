import { useState } from 'react';
import type { Session } from '@autopets/contracts/types';

export function TaskReturn({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  return <><button className="button task-return" aria-expanded={open} onClick={() => { setOpen(!open); setCopied(false); setCopyError(false); }}>Codex 작업 찾기 ↗</button>
    {open && <section className="task-return-guide" aria-label="같은 Codex 작업으로 돌아가기">
      <p className="body-copy">Codex에서 아래 작업명과 작업 ID가 같은 작업을 열어주세요. 현재 연결에서는 작업 창을 직접 열 수 없어요.</p>
      <dl className="return-details"><dt>작업명</dt><dd>{session.label}</dd><dt>작업 ID</dt><dd className="selectable">{session.id}</dd><dt>프로젝트</dt><dd className="selectable">{session.cwd || '경로 정보 없음'}</dd></dl>
      <button className="button secondary" onClick={async () => { try { await navigator.clipboard.writeText(session.id); setCopied(true); } catch { setCopyError(true); } }}>{copied ? '작업 ID 복사했어요' : '작업 ID 복사'}</button>
      {copyError && <p className="small-note" role="status">복사 기능을 사용할 수 없어요. 위의 작업 ID를 선택해서 복사해주세요.</p>}
    </section>}
  </>;
}
