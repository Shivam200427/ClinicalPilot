// Chat, Emergency and Observability state. Held above the router (so switching pages
// never resets it) and saved to localStorage (so a refresh doesn't either).
import { api, store, usePersisted } from './lib.js';
import { useToast } from './ui.jsx';

const { useState, useCallback, useRef, createContext, useContext } = React;

const GREETING = 'Ask about differentials, drug interactions, lab interpretation or guidelines.';
const Ctx = createContext(null);
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }) {
  const toast = useToast();

  // ── Chat ──
  const [chat, setChat] = usePersisted('chat', { msgs: [], meta: null });
  const [chatInput, setChatInput] = usePersisted('chat.draft', '');
  const [chatBusy, setChatBusy] = useState(false);
  const chatAbort = useRef(null);

  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    const msgs = [...chat.msgs, { role: 'user', content: text }];
    setChat(c => ({ ...c, msgs }));
    setChatInput('');
    setChatBusy(true);
    const ctrl = new AbortController(); chatAbort.current = ctrl;
    try {
      const d = await api('/api/chat', { method: 'POST', body: { messages: msgs.map(m => ({ role: m.role, content: m.content })) }, signal: ctrl.signal });
      setChat(c => ({ msgs: [...c.msgs, { role: 'assistant', content: d.reply, model: d.model }], meta: { model: d.model, latency: d.latency_ms, tokens: d.tokens } }));
    } catch (e) {
      if (e.name === 'AbortError') return;
      setChat(c => ({ ...c, msgs: [...c.msgs, { role: 'assistant', content: `Request failed: ${e.message}`, error: true }] }));
    } finally { chatAbort.current = null; setChatBusy(false); }
  }, [chat.msgs, chatInput, chatBusy, setChat, setChatInput]);

  const stopChat = useCallback(() => { try { chatAbort.current?.abort(); } catch {} setChatBusy(false); }, []);
  const clearChat = useCallback(() => { stopChat(); setChat({ msgs: [], meta: null }); }, [stopChat, setChat]);

  // ── Emergency ──
  const [em, setEm] = usePersisted('emergency', { input: '', result: null, latency: null, at: null });
  const [emBusy, setEmBusy] = useState(false);
  const runEmergency = useCallback(async () => {
    const text = em.input.trim();
    if (!text) { toast('Describe the presentation first', 'warning'); return; }
    if (emBusy) return;
    setEmBusy(true);
    const t0 = performance.now();
    try {
      const d = await api('/api/emergency', { method: 'POST', body: { text } });
      setEm(s => ({ ...s, result: d.emergency || d, latency: (performance.now() - t0) / 1000, at: Date.now() }));
    } catch (e) { toast(e.message, 'error'); }
    finally { setEmBusy(false); }
  }, [em.input, emBusy, setEm, toast]);

  // ── Observability (cached so it doesn't flash empty on navigation) ──
  const [obsSum, setObsSum] = useState(null);
  const [obsTraces, setObsTraces] = useState([]);
  const [obsAuto, setObsAuto] = usePersisted('obs.auto', false);
  const [obsError, setObsError] = useState(null);
  const loadObs = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([api('/api/observability/summary'), api('/api/observability/traces?limit=60')]);
      setObsSum(s); setObsTraces(t.traces || []); setObsError(null);
    } catch (e) { setObsError(e.message); }
  }, []);
  const clearObs = useCallback(async () => {
    try { await api('/api/observability/traces', { method: 'DELETE' }); } catch (e) { toast(e.message, 'error'); }
    loadObs();
  }, [loadObs, toast]);

  const value = {
    chat, chatInput, setChatInput, chatBusy, sendChat, stopChat, clearChat, greeting: GREETING,
    em, setEm, emBusy, runEmergency,
    obsSum, obsTraces, obsAuto, setObsAuto, obsError, loadObs, clearObs,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { store };
