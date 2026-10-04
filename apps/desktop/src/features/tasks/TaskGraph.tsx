import { type ReactNode, useEffect, useState } from 'react';
import type { Session, TaskGraphNode, TaskGraphSource } from '@autopets/contracts/types';
import { command, isDesktop } from '../../bridge/command';
import { Clock } from '../../app/shared/Clock';
import { status } from './presentation';

const surface = { 'codex-local': 'Codex에서 생성', 'work-local': 'Work 로컬에서 생성', unknown: '생성 환경 미확인' };
const samePath = (a: string, b: string) => a.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase() === b.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();

export function TaskGraph({ sessions, disconnected, now, onDetails }: {
  sessions: Session[]; disconnected: boolean; now: number; onDetails: (id: string) => void;
}) {
  const [sources, setSources] = useState<TaskGraphSource[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!isDesktop) return;
    let alive = true, busy = false;
    const refresh = async () => {
      if (busy) return; busy = true;
      try {
        const next = await command<TaskGraphSource[]>('task_graph_snapshot');
        if (!Array.isArray(next) || next.some(item => item.report?.version !== 1 || !Array.isArray(item.report.nodes))) throw new Error('Invalid task graph');
        if (alive) { setSources(next); setError(''); }
      } catch { if (alive) { setSources([]); setError('작업 관계를 다시 확인해주세요.'); } }
      finally { busy = false; }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 2000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  if (!sources.length) return error ? <p className="small-note" role="status">{error}</p> : null;
  return <section className="task-graph" aria-label="전달된 작업 관계"><h2>작업 관계</h2>
    <p className="small-note">읽어온 프로젝트·부모 관계예요. 계정과 현재 실행 환경은 미확인이며, 진행 상태는 별도로 전달된 활동이 있을 때만 표시해요.</p>
    {sources.map(({ report }) => {
      const nodes = new Map(report.nodes.map(node => [node.id, node]));
      const childOf = (node: TaskGraphNode) => {
        const parent = node.parentId ? nodes.get(node.parentId) : undefined;
        return parent?.projectId === node.projectId ? parent : undefined;
      };
      const projects = new Map<string | null, TaskGraphNode[]>();
      for (const node of report.nodes) { const group = projects.get(node.projectId) ?? []; group.push(node); projects.set(node.projectId, group); }
      function row(node: TaskGraphNode, seen = new Set<string>()): ReactNode {
        if (seen.has(node.id)) return null;
        const nextSeen = new Set(seen).add(node.id);
        // The legacy event transport is Codex-scoped. Work never borrows its progress.
        const session = node.creationSurface === 'codex-local' ? sessions.find(item => item.id === node.id && samePath(item.cwd, node.cwd)) : undefined;
        const children = report.nodes.filter(item => childOf(item)?.id === node.id);
        return <li key={node.id} data-graph-task={node.id}><div className="graph-task">
          {session ? <button className="text-button" onClick={() => onDetails(node.id)}>{node.label}</button> : <strong>{node.label}</strong>}
          <span>{surface[node.creationSurface]}</span><span>{session ? status(session, now, disconnected).text : '진행 미확인'}</span>
          <small>관계 관측 <Clock stamp={node.observedAt} /></small>
          {node.parentId && !childOf(node) && <small>부모 작업은 이 목록에서 확인되지 않았어요.</small>}
          {node.forkedFromId && <small>복제된 작업 · 하위 작업 관계와 별개</small>}
        </div>{children.length > 0 && <ul aria-label={`${node.label}의 하위 작업`}>{children.map(child => row(child, nextSeen))}</ul>}</li>;
      }
      return <div key={report.sourceId} className="graph-source">{[...projects].map(([id, group]) => <div key={id ?? 'unassigned'} className="graph-project">
        <h3>{id ? `프로젝트 · ${id}` : '프로젝트 미확인'}</h3><ul>{group.filter(node => !childOf(node)).map(node => row(node))}</ul>
      </div>)}</div>;
    })}
  </section>;
}
