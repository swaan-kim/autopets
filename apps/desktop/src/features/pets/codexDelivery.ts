import { useEffect, useRef, useState } from 'react';
import { command, isDesktop } from '../../bridge/command';

// What happened to a request the user pressed a button for (codex_chat.rs `Delivery`). The app sends
// it into the chat the screen showed through Codex's own queue; the words are built by the app.
//   queued      sent; Codex starts it in that chat (after a running turn, or once the chat is open)
//   unconfirmed Codex did not answer in time; it may already be there, so it is not typed in again
//   filled      could not be sent; typed into that chat's input box, the user presses send (`reason`)
//   new-chat    no chat to send to; a new Codex chat opened with it typed in, the user presses send
//   copy        too long for a link; `text` goes to the clipboard
export type Delivery = { outcome: 'queued' | 'unconfirmed' | 'filled' | 'new-chat' | 'copy'; id?: string | null; threadId?: string | null;
  sentAt: number; chatOpened: boolean; reason?: string | null; text?: string | null };
export type SendPhase = 'sending' | 'queued' | 'waiting' | 'started' | 'unconfirmed' | 'filled' | 'new-chat' | 'copy';
export type SendView = { phase: SendPhase; chat: string; reason?: string | null; id?: string | null };

export const FILL_PRESS = '보내기만 누르세요';
/** Seconds Codex usually needs to pick a queued message up; before that "보냈어요" is the honest word. */
const PICKUP_MS = 10_000;
const POLL_MS = 3_000;
const POLL_FOR_MS = 120_000;

/** Why a request could not be sent and was typed in instead, in one short phrase. */
export function fillReason(reason?: string | null) {
  if (reason === 'codex-cli-unavailable') return 'Codex 앱의 전송 도구를 찾지 못했어요';
  if (reason === 'codex-queue-unsupported') return '이 Codex 버전은 바로 보내기를 지원하지 않아요';
  if (reason === 'codex-chat-not-found') return 'Codex가 이 채팅을 찾지 못했어요';
  return '바로 보내지 못했어요';
}

/** A refused send (nothing went to Codex), or null when the caller has its own words for it. */
export function sendFailure(cause: unknown): string | null {
  const text = String(cause);
  if (text.includes('already-delivered')) return '방금 보낸 요청이에요. Codex 채팅을 확인해 주세요.';
  if (text.includes('delivery-in-progress')) return '다른 요청을 보내는 중이에요. 잠시 뒤 다시 눌러 주세요.';
  if (/target-chat-changed|review-chat-changed/.test(text)) return '보낼 채팅이 바뀌었어요. 화면을 확인하고 다시 눌러 주세요.';
  if (text.includes('codex-chat-available')) return '연결된 Codex 채팅이 생겼어요. 보낼 채팅을 확인하고 다시 눌러 주세요.';
  if (text.includes('delivery-record-failed')) return '전송 기록을 남기지 못해 보내지 않았어요. 다시 눌러 주세요.';
  return null;
}

/** The status line: 보내는 중… → 「채팅」에 보냈어요 → (Codex가 받는 중이에요) → 시작됐어요. */
export function sendText(view: SendView, short = false) {
  const chat = view.chat ? `「${view.chat}」` : '채팅';
  switch (view.phase) {
    case 'sending': return '보내는 중…';
    case 'queued': return `${chat}에 보냈어요`;
    case 'waiting': return short ? 'Codex가 받는 중이에요' : 'Codex가 받는 중이에요. 채팅이 바쁘거나 열려 있지 않으면 그다음에 시작해요.';
    case 'started': return '시작됐어요';
    case 'unconfirmed': return short ? 'Codex가 받았는지 확인 중이에요' : 'Codex가 받았는지 확인하는 중이에요. 다시 누르지 말고 Codex 채팅을 확인해 주세요.';
    case 'filled': return short ? `입력칸에 넣었어요 · ${FILL_PRESS}` : `${fillReason(view.reason)}. ${chat} 입력칸에 넣었어요. ${FILL_PRESS}.`;
    case 'new-chat': return `Codex 새 대화에 요청을 넣었어요. ${FILL_PRESS}.`;
    case 'copy': return '요청이 길어 복사했어요. Codex 채팅에 붙여넣고 보내 주세요.';
  }
}

export const viewOf = (delivery: Delivery, chat: string): SendView =>
  ({ phase: delivery.outcome, chat, reason: delivery.reason, id: delivery.id });

/**
 * One send at a time from this place, and the status of the last one. `send` runs the command
 * only when the user pressed the button; a second press while it runs does nothing. After a send,
 * `codex_send_status` is asked every few seconds until the chat shows the request (or 2 minutes).
 */
export function useCodexSend() {
  const [view, setView] = useState<SendView | null>(null);
  const pending = useRef(false);
  const send = async (run: () => Promise<Delivery>, chat: string): Promise<Delivery | null> => {
    if (pending.current) return null;
    pending.current = true;
    setView({ phase: 'sending', chat });
    try {
      const delivery = await run();
      setView(viewOf(delivery, chat));
      return delivery;
    } catch (cause) { setView(null); throw cause; }
    finally { pending.current = false; }
  };
  const track = (delivery: Delivery, chat: string) => setView(viewOf(delivery, chat));
  useDeliveryStatus(view, setView);
  return { view, send, track, clear: () => setView(null), busy: view?.phase === 'sending' };
}

function useDeliveryStatus(view: SendView | null, setView: (update: (current: SendView | null) => SendView | null) => void) {
  const id = view && (view.phase === 'queued' || view.phase === 'waiting' || view.phase === 'unconfirmed') ? view.id : null;
  useEffect(() => {
    if (!id || !isDesktop) return;
    const started = Date.now();
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const ask = async () => {
      let status = 'unknown';
      try { status = await command<string>('codex_send_status', { id }); } catch { /* keep the last words */ }
      if (!alive) return;
      setView(current => {
        if (!current || current.id !== id) return current;
        if (status === 'started') return { ...current, phase: 'started' };
        if (status === 'waiting' && current.phase === 'queued' && Date.now() - started >= PICKUP_MS) return { ...current, phase: 'waiting' };
        return current;
      });
      if (status !== 'started' && Date.now() - started < POLL_FOR_MS) timer = setTimeout(() => void ask(), POLL_MS);
    };
    timer = setTimeout(() => void ask(), POLL_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [id]);
}
