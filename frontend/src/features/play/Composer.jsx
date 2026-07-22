import { useRef, useState } from 'react';
import Button from '../../components/ui/Button.jsx';

export default function Composer({ connected, busy, onSend, suggestions = [], variant = 'console' }) {
  const [draft, setDraft] = useState('');
  const composingRef = useRef(false);
  const suppressEnterRef = useRef(false);
  const immersive = variant === 'immersive';

  const submit = (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy || !connected) return;
    onSend(text);
    setDraft('');
  };

  const placeholder = !connected
    ? '正在连接...'
    : busy
      ? '场景结算中...'
      : '点名、观察、请求立绘，或直接推进场景';

  return (
    <form className={`composer ${immersive ? 'immersive' : ''}`.trim()} onSubmit={submit}>
      {suggestions.length > 0 && (
        <div className="composer-suggestions" aria-label="输入建议">
          {suggestions.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => setDraft(suggestion)} disabled={!connected || busy}>
              {suggestion}
            </button>
          ))}
        </div>
      )}
      <div className="composer-input-row">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          disabled={!connected || busy}
          rows={1}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
            suppressEnterRef.current = true;
            window.requestAnimationFrame(() => {
              suppressEnterRef.current = false;
            });
          }}
          onKeyDown={(event) => {
            const nativeEvent = event.nativeEvent;
            const composing =
              composingRef.current ||
              suppressEnterRef.current ||
              event.isComposing ||
              nativeEvent?.isComposing ||
              nativeEvent?.keyCode === 229;
            if (event.key === 'Enter' && !event.shiftKey && !composing) {
              submit(event);
            }
          }}
        />
        <Button type="submit" variant="primary" disabled={!connected || busy || !draft.trim()}>
          发送
        </Button>
      </div>
      {!immersive && (
        <div className="composer-hint">{connected ? 'Enter 发送，Shift + Enter 换行' : '正在等待实时连接建立'}</div>
      )}
    </form>
  );
}
