import { useEffect, useState } from 'react';
import { command, isDesktop } from '../../bridge/command';

// Codex's own chat names (from its session index, via `codex_chat_titles`), so the
// app names the chat a pet uses instead of showing the end of its id. Shared
// across components and windows of this webview; refreshed when the app regains
// focus, because the chat may have been renamed in Codex meanwhile.
const cache = new Map<string, string>();

type ChatTarget = { threadId: string; cwd?: string };
const shortId = (threadId: string) => threadId.slice(-8);
const folder = (cwd?: string) => cwd?.split(/[\\/]/).filter(Boolean).pop();

/** The chat's Codex name, or `null` when Codex has none (yet) or it cannot be read. */
export const chatTitle = (titles: Record<string, string>, threadId: string) => titles[threadId] ?? null;
/** Name when known, otherwise "folder · id" (the previous label). */
export const chatName = (titles: Record<string, string>, target: ChatTarget) =>
  chatTitle(titles, target.threadId) ?? [folder(target.cwd), shortId(target.threadId)].filter(Boolean).join(' · ');
/** Name when known, otherwise "채팅 · id". */
export const chatBadge = (titles: Record<string, string>, threadId: string) => chatTitle(titles, threadId) ?? `채팅 · ${shortId(threadId)}`;
/** Hover text: where the chat works and its full id. */
export const chatDetail = (target: ChatTarget) => [target.cwd, target.threadId].filter(Boolean).join(' · ');

export function useCodexChatTitles(threadIds: ReadonlyArray<string | null | undefined>): Record<string, string> {
  const ids = [...new Set(threadIds.filter((id): id is string => !!id))].sort();
  const key = ids.join(',');
  const pick = () => Object.fromEntries(ids.flatMap(id => cache.has(id) ? [[id, cache.get(id)!]] : []));
  const [titles, setTitles] = useState<Record<string, string>>(pick);
  useEffect(() => {
    setTitles(pick());
    if (!isDesktop || !ids.length) return;
    let alive = true;
    const load = () => void command<Record<string, string>>('codex_chat_titles', { threadIds: ids }).then(found => {
      for (const id of ids) { if (found[id]) cache.set(id, found[id]); else cache.delete(id); }
      if (alive) setTitles(pick());
    }).catch(() => { /* keep the id label */ });
    load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; window.removeEventListener('focus', load); document.removeEventListener('visibilitychange', onVisible); };
  }, [key]);
  return titles;
}
