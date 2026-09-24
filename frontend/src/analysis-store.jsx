// Analysis engine. Lives above the router so a run keeps going across page switches,
// and is saved to localStorage so a refresh re-attaches to the server-side run.
import { API, api, openKeyPrompt, store } from './lib.js';
import { useToast } from './ui.jsx';

const { useState, useEffect, useRef, useCallback, createContext, useContext } = React;

export const STEPS = [
  { key: 'parse', label: 'Parse and anonymize' },
  { key: 'clinical', label: 'Clinical', role: 'clinical' },
  { key: 'literature', label: 'Literature', role: 'literature' },
  { key: 'safety', label: 'Safety', role: 'safety' },
  { key: 'med_panel', label: 'Medication check', role: 'med_panel' },
  { key: 'critic', label: 'Critic', role: 'critic' },
  { key: 'synthesizer', label: 'SOAP synthesis', role: 'synthesizer' },
];
const DEBATE_AGENTS = ['clinical', 'literature', 'safety', 'critic'];
const TERMINAL = ['complete', 'error', 'cancelled'];
const LIVE_CAP = 60000;
const HISTORY_MAX = 12;
const MAX_RECONNECTS = 6;

const freshSteps = () => Object.fromEntries(STEPS.map(s => [s.key, { status: 'pending' }]));
const idleRun = () => ({ id: null, status: 'idle', mode: 'analysis', started: null, ended: null, round: 0, maxRounds: 1, steps: freshSteps(), live: {}, data: {}, error: null, transport: null });

function settle(steps, to) {
  const out = {};
  for (const [k, v] of Object.entries(steps)) out[k] = v.status === 'active' ? { ...v, status: to, end: Date.now() } : v;
  return out;
}

// Apply one server event to the run state. `t` is the event time on the client clock.
function applyEvent(run, evt, t) {
  const steps = { ...run.steps };
  const begin = key => {
    if (steps.parse.status === 'active' && key !== 'parse') steps.parse = { ...steps.parse, status: 'done', end: t };
    steps[key] = { status: 'active', start: t };
  };
  switch (evt.type) {
    case 'status':
      if ((evt.stage || '').startsWith('pars') && steps.parse.status === 'pending') steps.parse = { status: 'active', start: t };
      if ((evt.stage || '').startsWith('synth') && steps.synthesizer.status === 'pending') begin('synthesizer');
      return { ...run, steps };
    case 'round_start': {
      if (steps.parse.status === 'active') steps.parse = { ...steps.parse, status: 'done', end: t };
      if (evt.round > 1) for (const a of DEBATE_AGENTS) steps[a] = { status: 'pending' };
      return { ...run, steps, round: evt.round, maxRounds: evt.max_rounds || run.maxRounds };
    }
    case 'agent': {
      if (!steps[evt.agent]) return run;
      if (evt.status === 'start') begin(evt.agent);
      else if (evt.status === 'done') steps[evt.agent] = { ...steps[evt.agent], status: 'done', end: t, consensus: evt.consensus };
      const data = evt.data ? { ...run.data, [evt.agent]: evt.data } : run.data;
      return { ...run, steps, data };
    }
    case 'agent_result':
      return { ...run, data: { ...run.data, [evt.agent]: evt.data } };
    case 'delta': {
      const cur = evt.reset ? '' : (run.live[evt.agent] || '');
      const next = (cur + (evt.text || '')).slice(-LIVE_CAP);
      return { ...run, live: { ...run.live, [evt.agent]: next } };
    }
    case 'live':
      return { ...run, live: { ...run.live, ...evt.agents } };
    case 'complete':
      return { ...run, status: 'done', ended: t, steps: Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, v.status === 'done' ? v : { ...v, status: 'done', end: t }])) };
    case 'error':
      return { ...run, status: 'error', ended: t, error: evt.message || 'The analysis failed.', steps: settle(steps, 'error') };
    case 'cancelled':
      return { ...run, status: 'stopped', ended: t, steps: settle(steps, 'stopped') };
    default:
      return run;
  }
}

const Ctx = createContext(null);
export const useAnalysis = () => useContext(Ctx);

export function AnalysisProvider({ children }) {
  const toast = useToast();
  const saved = useRef(store.get('analysis', null)).current || {};
  const [input, setInput] = useState(saved.input || '');
  const [run, setRun] = useState(saved.run || idleRun());
  const [res, setRes] = useState(saved.res || null);           // {soap, debate, med_error_panel, request_id}
  const [completedAt, setCompletedAt] = useState(saved.completedAt || null);
  const [prevSoap, setPrevSoap] = useState(saved.prevSoap || null); // before the last feedback run
  const [edited, setEdited] = useState(typeof saved.edited === 'number' ? saved.edited : null); // time of last clinician edit
  const [logs, setLogs] = useState(saved.logs || []);
  const [history, setHistory] = useState(() => store.get('history', []));

  const wsRef = useRef(null);
  const abortRef = useRef(null);
  const stoppedRef = useRef(false);
  const reconnects = useRef(0);
  const offsetRef = useRef(0);           // client clock minus server clock, in ms
  const runRef = useRef(run); runRef.current = run;
  const resRef = useRef(res); resRef.current = res;
  const inputRef = useRef(input); inputRef.current = input;

  // ── persistence (debounced; live text makes this chatty) ──
  useEffect(() => {
    const id = setTimeout(() => store.set('analysis', { input, run, res, completedAt, prevSoap, edited, logs: logs.slice(-150) }), 500);
    return () => clearTimeout(id);
  }, [input, run, res, completedAt, prevSoap, edited, logs]);
  useEffect(() => { store.set('history', history); }, [history]);

  const log = useCallback((src, msg, t = Date.now()) => setLogs(p => [...p.slice(-199), { t, src, msg }]), []);

  const busy = run.status === 'running';

  const saveHistory = useCallback((result, at, mode) => {
    const title = (inputRef.current || '').split('\n').find(l => l.trim())?.trim().slice(0, 90) || 'Untitled case';
    const entry = { id: result.request_id || String(at), at, title, input: inputRef.current, res: result, mode };
    setHistory(h => [entry, ...h.filter(x => x.id !== entry.id)].slice(0, HISTORY_MAX));
  }, []);

  const onComplete = useCallback((evt, t) => {
    const prev = resRef.current;
    const mode = runRef.current.mode;
    const result = { soap: evt.soap, debate: evt.debate, med_error_panel: evt.med_error_panel || prev?.med_error_panel, request_id: evt.request_id,
      feedbackAt: mode === 'feedback' ? t : null };
    if (mode === 'feedback' && prev?.soap) setPrevSoap(prev.soap); else setPrevSoap(null);
    setRes(result); setCompletedAt(t); setEdited(null);
    saveHistory(result, t, mode);
    log('system', mode === 'feedback' ? 'Re-analysis complete' : 'Analysis complete');
    toast(mode === 'feedback' ? 'Re-analysis complete' : 'Analysis complete', 'success');
  }, [log, toast, saveHistory]);

  const handleEvent = useCallback(evt => {
    if (evt.type === 'run') {
      offsetRef.current = evt.server_now ? Date.now() - evt.server_now * 1000 : 0;
      const started = evt.started ? evt.started * 1000 + offsetRef.current : Date.now();
      setRun(r => evt.resumed
        ? { ...idleRun(), mode: r.mode, id: evt.request_id, status: 'running', started, transport: 'ws' }
        : { ...r, id: evt.request_id, started, transport: 'ws' });
      if (evt.resumed) { setLogs([]); log('system', 'Reconnected to the analysis'); } // replay rebuilds the log
      return;
    }
    if (evt.type === 'gone') {
      setRun(r => ({ ...r, status: 'lost', ended: Date.now(), error: 'The server no longer has this run (it probably restarted). Run the case again.', steps: settle(r.steps, 'stopped') }));
      log('error', 'Run not found on the server');
      return;
    }
    const t = evt.ts ? evt.ts * 1000 + offsetRef.current : Date.now();
    setRun(r => applyEvent(r, evt, t));
    const label = STEPS.find(s => s.key === evt.agent)?.label || evt.agent;
    if (evt.type === 'agent' && evt.status === 'done') log('agent', `${label} finished${evt.consensus === true ? ' (consensus)' : evt.consensus === false ? ' (dissent)' : ''}`, t);
    else if (evt.type === 'agent' && evt.status === 'start') log('agent', `${label} started`, t);
    else if (evt.type === 'round_start' && (evt.max_rounds || 1) > 1) log('pipeline', `Round ${evt.round} of ${evt.max_rounds}`, t);
    else if (evt.type === 'status' && evt.detail) log('pipeline', evt.detail, t);
    else if (evt.type === 'complete') onComplete(evt, t);
    else if (evt.type === 'error') {
      log('error', evt.message || 'Analysis failed');
      if (evt.needs_key) openKeyPrompt(evt.key_ref, evt.profile, evt.reason);
      toast(evt.message || 'Analysis failed', 'error');
    } else if (evt.type === 'cancelled') log('system', 'Stopped');
  }, [log, toast, onComplete]);

  // Open a socket and send `payload` ({text…} to start, {resume:id} to re-attach).
  // Resolves false only if the socket never opened, so callers can fall back to REST.
  const connect = useCallback(payload => new Promise(resolve => {
    let ws;
    try { ws = new WebSocket(`${API.replace(/^http/, 'ws')}/ws/analyze`); } catch { resolve(false); return; }
    wsRef.current = ws;
    let opened = false, finished = false;
    const openTimer = setTimeout(() => { if (!opened) { try { ws.close(); } catch {} } }, 5000);
    ws.onopen = () => { opened = true; clearTimeout(openTimer); reconnects.current = 0; ws.send(JSON.stringify(payload)); resolve(true); };
    ws.onmessage = e => {
      let evt; try { evt = JSON.parse(e.data); } catch { return; }
      if (TERMINAL.includes(evt.type) || evt.type === 'gone') finished = true;
      handleEvent(evt);
    };
    ws.onclose = () => {
      clearTimeout(openTimer);
      if (wsRef.current === ws) wsRef.current = null;
      if (!opened) { resolve(false); return; }
      if (finished || stoppedRef.current) return;
      // Dropped mid-run (sleep, network blip, proxy timeout). The server keeps going; re-attach.
      const id = runRef.current.id;
      if (!id || runRef.current.status !== 'running') return;
      if (reconnects.current >= MAX_RECONNECTS) {
        setRun(r => ({ ...r, status: 'lost', error: 'Lost connection to the server. The run may still be going. Press Reconnect.' }));
        return;
      }
      reconnects.current += 1;
      log('system', 'Connection dropped, reconnecting');
      setTimeout(() => { if (!stoppedRef.current && runRef.current.status === 'running') connect({ resume: id }); }, 1000 * reconnects.current);
    };
  }), [handleEvent, log]);

  // REST fallback, used only when WebSockets can't connect at all.
  const runRest = useCallback(async text => {
    log('system', 'Live connection unavailable, using a single request');
    setRun(r => ({ ...r, transport: 'rest', steps: Object.fromEntries(STEPS.map(s => [s.key, { status: 'active', start: Date.now() }])) }));
    const ctrl = new AbortController(); abortRef.current = ctrl;
    try {
      const data = await api('/api/analyze', { method: 'POST', body: { text }, signal: ctrl.signal });
      const t = Date.now();
      setRun(r => ({ ...r, status: 'done', ended: t, steps: settle(r.steps, 'done') }));
      onComplete({ ...data, type: 'complete' }, t);
    } catch (e) {
      if (stoppedRef.current || e.name === 'AbortError') return;
      setRun(r => ({ ...r, status: 'error', ended: Date.now(), error: e.message, steps: settle(r.steps, 'error') }));
      log('error', e.message); toast(e.message, 'error');
    } finally { abortRef.current = null; }
  }, [log, toast, onComplete]);

  const start = useCallback(async (payload, mode) => {
    stoppedRef.current = false; reconnects.current = 0;
    setRun({ ...idleRun(), mode, status: 'running', started: Date.now() });
    setLogs([]);
    log('system', mode === 'feedback' ? 'Re-analysis started with your feedback' : 'Analysis started');
    const ok = await connect(payload);
    if (!ok && !stoppedRef.current) {
      if (mode === 'feedback') {
        setRun(r => ({ ...r, status: 'error', ended: Date.now(), error: 'Could not connect to the server.' }));
        return;
      }
      await runRest(payload.text);
    }
  }, [connect, runRest, log]);

  const runAnalysis = useCallback(() => {
    if (busy) return;
    const text = input.trim();
    if (!text) { toast('Enter a case first', 'warning'); return; }
    setRes(null); setPrevSoap(null); setEdited(null); setCompletedAt(null);
    start({ text }, 'analysis');
  }, [busy, input, start, toast]);

  const sendFeedback = useCallback(feedback => {
    if (busy || !res?.soap) return false;
    start({ text: input.trim(), feedback, edited_soap: JSON.stringify(res.soap) }, 'feedback');
    return true;
  }, [busy, res, input, start]);

  const stop = useCallback(() => {
    if (!busy) return;
    stoppedRef.current = true;
    const id = runRef.current.id;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify({ type: 'cancel' })); } catch {} }
    if (id) fetch(`${API}/api/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }).catch(() => {});
    setTimeout(() => { try { ws?.close(); } catch {} }, 300);
    try { abortRef.current?.abort(); } catch {}
    setRun(r => ({ ...r, status: 'stopped', ended: Date.now(), steps: settle(r.steps, 'stopped') }));
    log('system', 'Stopped by you');
    toast('Analysis stopped', 'info');
  }, [busy, log, toast]);

  const reconnect = useCallback(() => {
    const id = runRef.current.id;
    if (!id) return;
    stoppedRef.current = false; reconnects.current = 0;
    setRun(r => ({ ...r, status: 'running', error: null }));
    connect({ resume: id }).then(ok => {
      if (!ok) setRun(r => ({ ...r, status: 'lost', error: 'Still cannot reach the server. Is it running?' }));
    });
  }, [connect]);

  // After a refresh: re-attach to a run that was still going.
  useEffect(() => {
    const r = runRef.current;
    if (r.status === 'running' && r.id) { log('system', 'Reconnecting to the analysis in progress'); reconnect(); }
    else if (r.status === 'running') setRun(x => ({ ...x, status: 'lost', error: 'The page reloaded before the run started. Run it again.' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clear = useCallback(() => {
    if (busy) return;
    setInput(''); setRes(null); setPrevSoap(null); setEdited(null); setCompletedAt(null);
    setRun(idleRun()); setLogs([]);
  }, [busy]);

  const updateSoap = useCallback(patch => {
    setRes(r => r ? { ...r, soap: { ...r.soap, ...patch } } : r);
    setEdited(Date.now());
  }, []);

  const openHistory = useCallback(entry => {
    if (busy) { toast('Stop the current run first', 'warning'); return; }
    setInput(entry.input || ''); setRes(entry.res); setCompletedAt(entry.at);
    setPrevSoap(null); setEdited(null); setRun(idleRun()); setLogs([]);
  }, [busy, toast]);
  const removeHistory = useCallback(id => setHistory(h => h.filter(x => x.id !== id)), []);

  const value = {
    input, setInput, run, res, completedAt, prevSoap, edited, logs, history, busy,
    runAnalysis, sendFeedback, stop, reconnect, clear, updateSoap, openHistory, removeHistory, log,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
