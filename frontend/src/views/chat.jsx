import { Icon, Spinner, MicBtn, Markdown } from '../ui.jsx';
import { useSession } from '../session-store.jsx';
import { copyText } from '../lib.js';

const { useEffect, useRef } = React;

const STARTERS = [
  'First-line management of new atrial fibrillation with RVR?',
  'Interpret: Na 128, serum osm 265, urine osm 450, urine Na 45',
  'Can I give a PCI patient on metformin iodinated contrast?',
];

export function ChatView() {
  const { chat, chatInput, setChatInput, chatBusy, sendChat, stopChat, clearChat, greeting } = useSession();
  const endRef = useRef(null);
  const taRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [chat.msgs.length, chatBusy]);
  useEffect(() => { const el = taRef.current; if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 200) + 'px'; } }, [chatInput]);

  return <div className="mx-auto flex max-w-3xl flex-col px-4 sm:px-6" style={{ height: 'calc(100dvh - 65px)' }}>
    <div className="anim-fade-up flex items-center justify-between gap-3 pb-4 pt-6">
      <div className="flex items-center gap-3">
        <div>
        <h1 className="text-xl font-semibold text-white">AI clinical assistant</h1>
        <p className="mt-0.5 text-xs text-zinc-400">{chat.meta ? `${chat.meta.model} · ${(chat.meta.latency / 1000).toFixed(1)}s · ${chat.meta.tokens ?? '?'} tokens` : 'Conversational clinical Q&A on the chat engine set in Settings'}</p>
        </div>
      </div>
      {chat.msgs.length > 0 && <button className="btn btn-ghost btn-sm" onClick={clearChat}><Icon name="trash" size={13} />Clear</button>}
    </div>

    <div className="flex-1 space-y-4 overflow-y-auto py-2" role="log" aria-live="polite" aria-label="Conversation">
      {chat.msgs.length === 0 && <div className="py-6">
        <p className="text-sm text-zinc-400">{greeting}</p>
        <div className="mt-4 flex flex-col items-start gap-2">
          {STARTERS.map(s => <button key={s} className="btn btn-secondary text-left" onClick={() => { setChatInput(s); taRef.current?.focus(); }}>{s}</button>)}
        </div>
      </div>}
      {chat.msgs.map((m, i) => m.role === 'user'
        ? <div key={i} className="flex justify-end"><div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand-600 px-4 py-3 text-[15px] text-white">{m.content}</div></div>
        : <div key={i} className="group max-w-[90%] rounded-2xl rounded-bl-md border border-zinc-700 bg-zinc-800 px-4 py-3">
          <Markdown text={m.content} className={`text-[15px] leading-relaxed ${m.error ? 'text-rose-300' : 'text-zinc-200'}`} />
          {!m.error && <button className="mt-1.5 text-xs text-zinc-500 opacity-0 transition-opacity hover:text-zinc-300 focus:opacity-100 group-hover:opacity-100" onClick={() => copyText(m.content)}>Copy</button>}
        </div>)}
      {chatBusy && <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-400"><Spinner />Thinking…</div>}
      <div ref={endRef} />
    </div>

    <div className="border-t border-zinc-800 py-3">
      <div className="flex items-end gap-2">
        <label htmlFor="chat-in" className="sr-only">Message</label>
        <textarea id="chat-in" ref={taRef} rows={1} value={chatInput} onChange={e => setChatInput(e.target.value)}
          placeholder="Ask a clinical question" className="field resize-none text-[15px]"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendChat(); } }} />
        <MicBtn onTranscript={t => setChatInput(p => (p ? p + ' ' : '') + t)} />
        {chatBusy
          ? <button className="btn btn-stop" onClick={stopChat} aria-label="Stop"><Icon name="square" size={13} /></button>
          : <button className="btn btn-primary" onClick={sendChat} disabled={!chatInput.trim()} aria-label="Send"><Icon name="send" size={15} /></button>}
      </div>
      <p className="mt-1.5 text-xs text-zinc-500">Enter to send, Shift+Enter for a new line.</p>
    </div>
  </div>;
}
