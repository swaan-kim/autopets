// Input bubble shown beside the preview pet.
//
// UI only: submitted text stays in this window's memory (`messages`) and is
// echoed in the bubble. Nothing is sent to Codex or any AI yet; the future
// hook is the `onSubmit(text, messages)` callback supplied by pet.js.

const NOTE_IDLE = '테스트 입력창이에요 · 아직 AI에는 전달되지 않아요';

export function createInputBubble({ onSubmit } = {}) {
  const root = document.createElement('section');
  root.className = 'bubble';
  root.hidden = true;
  root.setAttribute('aria-label', '펫 입력창');
  root.innerHTML = `
    <p class="bubble-note" aria-live="polite"></p>
    <form class="bubble-form">
      <textarea class="bubble-input" rows="2" maxlength="500"
        placeholder="무엇을 도와드릴까요?" aria-label="펫에게 보낼 메시지"></textarea>
      <button class="bubble-send" type="submit" title="보내기 (Enter)" aria-label="보내기" disabled>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" fill="none" stroke="currentColor"
            stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </form>`;

  const note = root.querySelector('.bubble-note');
  const form = root.querySelector('.bubble-form');
  const input = root.querySelector('.bubble-input');
  const send = root.querySelector('.bubble-send');
  const messages = [];
  note.textContent = NOTE_IDLE;

  const syncSend = () => { send.disabled = input.value.trim() === ''; };

  function submit() {
    const text = input.value.trim();
    if (!text) return;
    messages.push(text);
    input.value = '';
    syncSend();
    note.textContent = `입력한 내용 ${messages.length}개 · 최근: ${text}`;
    note.title = text;
    note.classList.add('has-message');
    onSubmit?.(text, messages.slice());
    input.focus();
  }

  input.addEventListener('input', syncSend);
  input.addEventListener('keydown', (event) => {
    // Enter sends, Shift+Enter adds a line. Never send while a Korean (IME)
    // composition is still being confirmed with Enter.
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    submit();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });

  return {
    element: root,
    messages,
    get isOpen() { return !root.hidden; },
    open({ focusInput = true } = {}) {
      root.hidden = false;
      if (focusInput) input.focus();
    },
    close() {
      root.hidden = true;
    },
  };
}
