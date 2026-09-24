import { api, copyText, usePersisted } from '../lib.js';
import { Icon, Spinner, PageHeader, CardHead, IconTile, Switch, Tabs, useToast } from '../ui.jsx';

const { useState, useEffect, useCallback, useId, useRef } = React;

const PROVIDERS = [['ollama', 'Ollama (local)'], ['openai', 'OpenAI'], ['groq', 'Groq'], ['anthropic', 'Anthropic'], ['azure', 'Azure OpenAI'], ['openai_compatible', 'OpenAI-compatible']];
const ROLE_LABELS = { default: 'Default (anything not listed)', chat: 'Assistant chat', clinical: 'Clinical agent', literature: 'Literature agent', safety: 'Safety agent', critic: 'Critic', synthesizer: 'SOAP synthesis', emergency: 'Emergency triage', med_panel: 'Medication check' };
const PRESETS = {
  ollama: { label: 'Local Ollama model', provider: 'ollama', model: 'medgemma1.5', base_url: 'http://localhost:11434', api_key_ref: null, serialize: false, params: { temperature: 0.2, max_tokens: 4096, json_mode: false } },
  openai: { label: 'OpenAI', provider: 'openai', model: 'gpt-4o-mini', base_url: null, api_key_ref: 'OPENAI_API_KEY', serialize: false, params: { temperature: 0.2, max_tokens: 4096, json_mode: true } },
  groq: { label: 'Groq', provider: 'groq', model: 'openai/gpt-oss-120b', base_url: null, api_key_ref: 'GROQ_API_KEY', serialize: true, params: { temperature: 0.2, max_tokens: 2048, json_mode: true } },
  anthropic: { label: 'Anthropic', provider: 'anthropic', model: 'claude-sonnet-5', base_url: null, api_key_ref: 'ANTHROPIC_API_KEY', serialize: false, params: { temperature: 0.2, max_tokens: 4096, json_mode: false } },
  openai_compatible: { label: 'OpenAI-compatible server', provider: 'openai_compatible', model: '', base_url: 'http://localhost:1234/v1', api_key_ref: null, serialize: false, params: { temperature: 0.2, max_tokens: 4096, json_mode: false } },
};
const KEY_STATUS = {
  hardcoded: ['Key from .env', 'text-emerald-300'], runtime: ['Key set for this session', 'text-brand-300'],
  missing: ['Key missing', 'text-amber-300'], none: ['No key needed', 'text-zinc-400'],
};

function Field({ label, hint, children }) {
  const id = useId();
  return <div>
    <label htmlFor={id} className="label">{label}</label>
    {React.cloneElement(children, { id })}
    {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
  </div>;
}

/* ── Demo mode ── */
function DemoCard() {
  const toast = useToast();
  const [on, setOn] = useState(null);
  useEffect(() => { api('/api/config-status').then(d => setOn(!!d.demo)).catch(() => setOn(false)); }, []);
  const toggle = async v => {
    setOn(v);
    try { const d = await api('/api/config/demo', { method: 'POST', body: { enabled: v } }); setOn(!!d.enabled); toast(d.enabled ? 'Demo mode on' : 'Demo mode off', 'info'); window.dispatchEvent(new Event('cp:config')); }
    catch (e) { setOn(!v); toast(e.message, 'error'); }
  };
  return <section className={`card p-5 ${on ? 'border-amber-500/30 bg-amber-500/[.04]' : ''}`}>
    <Switch checked={!!on} disabled={on === null} onChange={toggle} label="Demo mode"
      description="Analysis, Emergency, Chat, the drug check and Observability use a built-in STEMI case instead of calling models. A full run takes about 15 seconds. Useful for presentations or when no model is available. Resets when the server restarts; set DEMO_MODE=true in .env to start with it on." />
  </section>;
}

/* ── Local model (Ollama) ── */
function fmtUntil(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d) || d.getFullYear() > 2100) return 'until Ollama restarts';
  const mins = Math.round((d - Date.now()) / 60000);
  return mins <= 1 ? 'for about a minute' : `for about ${mins} more minutes`;
}

function LocalModelCard() {
  const toast = useToast();
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api('/api/ollama/status').then(setSt).catch(() => setSt({ configured: false })), []);
  useEffect(() => { load(); const iv = setInterval(load, 15000); return () => clearInterval(iv); }, [load]);
  if (!st) return <section className="card p-4 text-sm text-zinc-400"><Spinner /> Checking the local model</section>;
  if (!st.configured) return null;

  const setLoaded = async keep => {
    setBusy(true);
    try {
      const d = await api('/api/ollama/load', { method: 'POST', body: { profile_id: st.profile, keep_alive: keep } });
      if (!d.ok) throw new Error(d.error || 'Ollama did not respond');
      toast(keep === 0 ? 'Model unloaded' : `Model loaded in ${(d.latency_ms / 1000).toFixed(1)}s`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); load(); }
  };
  const pull = `ollama pull ${st.model}`;

  const Row = ({ ok, children }) => <li className="flex items-start gap-2 text-sm">
    {ok ? <Icon name="check" size={14} className="mt-0.5 text-emerald-400" /> : <Icon name="x" size={14} className="mt-0.5 text-zinc-500" />}
    <span className={ok ? 'text-zinc-200' : 'text-zinc-400'}>{children}</span>
  </li>;

  return <section className="card" aria-labelledby="local-h">
    <CardHead id="local-h" icon="cpu" tone="blue" title="Local model" subtitle={`${st.model} at ${st.base_url}`} />
    <div className="p-5">
      {st.deployed && <p className="mb-3 text-sm text-amber-200">This server runs in deployed mode, so local engines are skipped and their roles use the cloud fallback.</p>}
      <ul className="space-y-1.5">
        <Row ok={st.reachable}>{st.reachable ? 'Ollama is running' : <>Ollama is not reachable. Install it from <a className="text-brand-300 underline underline-offset-2" href="https://ollama.com/download" target="_blank" rel="noopener noreferrer">ollama.com/download</a> and start it.</>}</Row>
        {st.reachable && <Row ok={st.installed}>{st.installed ? `${st.model} is downloaded` : `${st.model} is not downloaded yet`}</Row>}
        {st.reachable && st.installed && <Row ok={st.loaded}>{st.loaded ? `Loaded in memory ${fmtUntil(st.expires_at)}` : 'Not loaded. The first request will load it, which can take a while.'}</Row>}
      </ul>

      {st.reachable && !st.installed && <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200">{pull}</code>
        <button className="btn btn-secondary btn-sm" onClick={async () => toast((await copyText(pull)) ? 'Copied' : 'Copy failed', 'info')}><Icon name="copy" size={13} />Copy</button>
      </div>}

      {st.reachable && st.installed && <div className="mt-4 flex flex-wrap items-center gap-2">
        {!st.loaded
          ? <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => setLoaded('30m')}>{busy ? <Spinner /> : null}Load into memory</button>
          : <>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setLoaded('30m')}>Keep for 30 more minutes</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setLoaded(0)}>Unload</button>
          </>}
        <button className="btn btn-ghost btn-sm" onClick={load} aria-label="Refresh status"><Icon name="refresh" size={13} /></button>
      </div>}
      {st.reachable && st.installed && <p className="mt-2 text-xs leading-relaxed text-zinc-500">
        Loading reads the model into memory and generates nothing, so the first analysis doesn't pay the load time. Nothing runs in the background. Ollama unloads it after a few idle minutes following your last request.
      </p>}
    </div>
  </section>;
}

/* ── Engines ── */
function EngineCard({ prof, onChanged, testResult }) {
  const toast = useToast();
  const [p, setP] = useState(prof);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState('');
  const [test, setTest] = useState(null);
  const [models, setModels] = useState([]);
  useEffect(() => { setP(prof); }, [prof]);
  useEffect(() => { if (testResult) setTest(testResult); }, [testResult]);
  const dirty = JSON.stringify({ ...p, key_status: 0 }) !== JSON.stringify({ ...prof, key_status: 0 });
  const upd = (k, v) => setP(x => ({ ...x, [k]: v }));
  const updParam = (k, v) => setP(x => ({ ...x, params: { ...x.params, [k]: v } }));
  const listId = `models-${prof.id}`;

  const save = async () => {
    setBusy('save');
    try { const body = { ...p }; delete body.key_status; await api('/api/config/profiles', { method: 'POST', body }); toast(`Saved ${p.label || p.id}`, 'success'); onChanged(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };
  const saveKey = async () => {
    if (!key.trim() || !p.api_key_ref) return;
    try { await api('/api/config/secret', { method: 'POST', body: { key_ref: p.api_key_ref, value: key.trim() } }); setKey(''); toast('Key saved for this session', 'success'); onChanged(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const doTest = async () => {
    setBusy('test'); setTest(null);
    try { setTest(await api('/api/config/test', { method: 'POST', body: { profile_id: p.id } })); }
    catch (e) { setTest({ ok: false, error: e.message }); } finally { setBusy(''); }
  };
  const discover = async () => {
    setBusy('discover');
    try {
      const d = await api(`/api/config/discover?profile_id=${encodeURIComponent(p.id)}`);
      if (d.ok && d.models.length) { setModels(d.models); toast(`${d.models.length} models found. Pick one in the Model field.`, 'info'); }
      else toast(d.error || 'No models found at this endpoint', 'warning');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };
  const del = async () => {
    if (!confirm(`Delete the engine "${p.label || p.id}"? Roles using it fall back to their other engines.`)) return;
    try { await api(`/api/config/profiles/${encodeURIComponent(p.id)}`, { method: 'DELETE' }); toast('Engine deleted', 'success'); onChanged(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const ks = KEY_STATUS[p.key_status || 'none'] || KEY_STATUS.none;

  return <section className="card" aria-label={p.label || p.id}>
    <div className="card-head">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0">
          <h3 className="card-title truncate">{p.label || p.id}</h3>
          <p className="font-mono text-xs text-zinc-500">{p.id}</p>
        </div>
      </div>
      <span className={`text-xs ${ks[1]}`}>{ks[0]}</span>
    </div>
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
      <Field label="Name"><input className="field" value={p.label || ''} onChange={e => upd('label', e.target.value)} /></Field>
      <Field label="Provider"><select className="field" value={p.provider} onChange={e => upd('provider', e.target.value)}>{PROVIDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor={`${listId}-in`} className="text-xs font-medium text-zinc-400">Model</label>
          <button className="text-xs text-brand-300 hover:text-brand-200 disabled:opacity-50" onClick={discover} disabled={!!busy}>{busy === 'discover' ? 'Looking…' : 'Find models'}</button>
        </div>
        <input id={`${listId}-in`} className="field font-mono text-[13px]" list={listId} value={p.model} onChange={e => upd('model', e.target.value)} placeholder="model name" />
        <datalist id={listId}>{models.map(m => <option key={m} value={m} />)}</datalist>
      </div>
      <Field label="Base URL" hint="Leave empty for the provider default."><input className="field font-mono text-[13px]" value={p.base_url || ''} onChange={e => upd('base_url', e.target.value || null)} /></Field>
      <Field label="Key variable" hint="Name of the env var holding the key. Empty for local models."><input className="field font-mono text-[13px]" value={p.api_key_ref || ''} onChange={e => upd('api_key_ref', e.target.value || null)} placeholder="none" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Temperature"><input className="field" type="number" step="0.1" min="0" max="2" value={p.params.temperature} onChange={e => updParam('temperature', parseFloat(e.target.value))} /></Field>
        <Field label="Max tokens"><input className="field" type="number" min="1" value={p.params.max_tokens} onChange={e => updParam('max_tokens', parseInt(e.target.value) || 0)} /></Field>
      </div>
      <div className="space-y-3 sm:col-span-2">
        <Switch checked={!!p.params.json_mode} onChange={v => updParam('json_mode', v)} label="Force JSON output"
          description="Turn off for small local models that stall under JSON constraints. Replies are still parsed either way." />
        <Switch checked={!!p.serialize} onChange={v => upd('serialize', v)} label="One call at a time"
          description="Runs agents in sequence instead of in parallel. Use for free tiers with tight rate limits." />
      </div>
      {p.api_key_ref && p.key_status !== 'hardcoded' && <div className="sm:col-span-2">
        <label htmlFor={`${listId}-key`} className="label">{p.api_key_ref}</label>
        <div className="flex gap-2">
          <input id={`${listId}-key`} type="password" autoComplete="off" className="field" value={key} onChange={e => setKey(e.target.value)} placeholder="Paste key" onKeyDown={e => { if (e.key === 'Enter') saveKey(); }} />
          <button className="btn btn-secondary" onClick={saveKey} disabled={!key.trim()}>Set key</button>
        </div>
        <p className="mt-1 text-xs text-zinc-500">Held in server memory until restart. Put it in .env to keep it.</p>
      </div>}
    </div>
    <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 px-4 py-3">
      <button className="btn btn-primary btn-sm" onClick={save} disabled={!dirty || !!busy}>{busy === 'save' && <Spinner />}{dirty ? 'Save changes' : 'Saved'}</button>
      {dirty && <button className="btn btn-ghost btn-sm" onClick={() => setP(prof)}>Discard</button>}
      <button className="btn btn-secondary btn-sm" onClick={doTest} disabled={!!busy}>{busy === 'test' && <Spinner />}Test</button>
      {test && <span className={`min-w-0 truncate text-xs ${test.ok ? 'text-emerald-300' : 'text-rose-300'}`} title={test.error || ''}>
        {test.ok ? `Works · ${(test.latency_ms / 1000).toFixed(1)}s` : `Failed: ${test.error || 'no response'}`}
      </span>}
      <button className="btn btn-ghost btn-sm ml-auto text-rose-300" onClick={del} aria-label={`Delete ${p.label || p.id}`}><Icon name="trash" size={13} /></button>
    </div>
  </section>;
}

function AddEngine({ existing, onAdded }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState('ollama');
  const [id, setId] = useState('');
  const slug = s => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const add = async () => {
    const pid = slug(id || PRESETS[preset].label);
    if (!pid) return;
    if (existing.includes(pid)) { toast(`An engine called "${pid}" already exists`, 'warning'); return; }
    const base = PRESETS[preset];
    const body = { ...base, id: pid, label: id.trim() || base.label, params: { ...base.params, stop: null } };
    if (preset === 'openai_compatible') body.api_key_ref = null;
    try { await api('/api/config/profiles', { method: 'POST', body }); toast('Engine added', 'success'); setOpen(false); setId(''); onAdded(); }
    catch (e) { toast(e.message, 'error'); }
  };
  if (!open) return <button className="btn btn-secondary" onClick={() => setOpen(true)}>Add engine</button>;
  return <div className="card flex flex-wrap items-end gap-3 p-4">
    <Field label="Type"><select className="field" value={preset} onChange={e => setPreset(e.target.value)}>{Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
    <Field label="Name"><input className="field" value={id} onChange={e => setId(e.target.value)} placeholder={PRESETS[preset].label} autoFocus /></Field>
    <div className="flex gap-2"><button className="btn btn-primary" onClick={add}>Add</button><button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button></div>
    <p className="w-full text-xs text-zinc-500">Starts with sensible defaults for {PRESETS[preset].label}. Adjust model and URL afterwards.</p>
  </div>;
}

/* ── Routing ── */
function RoutingTable({ cfg, onSaved }) {
  const toast = useToast();
  const ids = Object.keys(cfg.profiles);
  const label = id => cfg.profiles[id]?.label || id;
  const local = ids.find(i => cfg.profiles[i].provider === 'ollama');
  const cloud = ids.find(i => cfg.profiles[i].provider !== 'ollama' && cfg.profiles[i].key_status !== 'missing') || ids.find(i => cfg.profiles[i].provider !== 'ollama');
  const [applying, setApplying] = useState(false);

  const put = (role, route) => api(`/api/config/roles/${role}`, { method: 'PUT', body: route });
  const saveRole = async (role, route) => { try { onSaved(await put(role, route)); } catch (e) { toast(e.message, 'error'); } };
  const applyPreset = async (name, map) => {
    setApplying(true);
    try { let last; for (const role of cfg.roles_available) last = await put(role, map(role)); onSaved(last); toast(`Routing set to "${name}"`, 'success'); }
    catch (e) { toast(e.message, 'error'); } finally { setApplying(false); }
  };
  const presets = [];
  if (local && cloud) presets.push(['Local for Clinical and Chat', r => (r === 'clinical' || r === 'chat') ? { primary: local, fallbacks: [cloud] } : { primary: cloud, fallbacks: [] }]);
  if (local) presets.push([`Everything on ${label(local)}`, () => ({ primary: local, fallbacks: cloud ? [cloud] : [] })]);
  if (cloud) presets.push([`Everything on ${label(cloud)}`, () => ({ primary: cloud, fallbacks: [] })]);

  return <div className="space-y-4">
    {presets.length > 0 && <section className="card p-4">
      <h3 className="text-sm font-semibold text-zinc-100">Quick setups</h3>
      <p className="mt-0.5 text-xs text-zinc-400">Sets every role at once. You can fine-tune below.</p>
      <div className="mt-3 flex flex-wrap gap-2">{presets.map(([n, m]) => <button key={n} className="btn btn-secondary btn-sm" disabled={applying} onClick={() => applyPreset(n, m)}>{n}</button>)}</div>
    </section>}
    <section className="card">
      <div className="card-head"><h3 className="card-title">Per role</h3><span className="text-xs text-zinc-400">Primary engine, then fallbacks in the order you add them</span></div>
      <ul className="divide-y divide-zinc-800/70">
        {cfg.roles_available.map(role => {
          const route = cfg.roles[role] || { primary: ids[0], fallbacks: [] };
          const fbs = route.fallbacks || [];
          return <li key={role} className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[200px_1fr] sm:items-center">
            <label htmlFor={`route-${role}`} className="text-sm text-zinc-200">{ROLE_LABELS[role] || role}</label>
            <div className="flex flex-wrap items-center gap-2">
              <select id={`route-${role}`} className="field w-auto py-1.5" value={route.primary} onChange={e => saveRole(role, { primary: e.target.value, fallbacks: fbs.filter(f => f !== e.target.value) })}>
                {ids.map(i => <option key={i} value={i}>{label(i)}</option>)}
              </select>
              {ids.filter(i => i !== route.primary).length > 0 && <span className="text-xs text-zinc-500">then</span>}
              {ids.filter(i => i !== route.primary).map(i => {
                const on = fbs.includes(i);
                return <button key={i} aria-pressed={on} onClick={() => saveRole(role, { primary: route.primary, fallbacks: on ? fbs.filter(f => f !== i) : [...fbs, i] })}
                  className={`rounded-md border px-2 py-1 text-xs transition-colors ${on ? 'border-brand-500/50 bg-brand-500/10 text-brand-200' : 'border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'}`}>
                  {on ? `${fbs.indexOf(i) + 1}. ` : '+ '}{label(i)}
                </button>;
              })}
            </div>
          </li>;
        })}
      </ul>
    </section>
  </div>;
}

export function SettingsView() {
  const toast = useToast();
  const [cfg, setCfg] = useState(null);
  const [tab, setTab] = usePersisted('settings.tab', 'engines');
  const [tests, setTests] = useState({});
  const [testingAll, setTestingAll] = useState(false);
  const load = useCallback(() => api('/api/config/models').then(setCfg).catch(e => toast(`Could not load settings: ${e.message}`, 'error')), [toast]);
  useEffect(() => { load(); }, [load]);
  const changed = useCallback(() => { load(); window.dispatchEvent(new Event('cp:config')); }, [load]);

  const testAll = async () => {
    setTestingAll(true); setTests({});
    const ids = Object.keys(cfg.profiles);
    const out = await Promise.all(ids.map(id => api('/api/config/test', { method: 'POST', body: { profile_id: id } }).catch(e => ({ ok: false, error: e.message }))));
    setTests(Object.fromEntries(ids.map((id, i) => [id, out[i]])));
    const bad = out.filter(r => !r.ok).length;
    toast(bad ? `${bad} of ${ids.length} engines failed` : 'All engines responded', bad ? 'warning' : 'success');
    setTestingAll(false);
  };
  const saveDebate = async patch => { try { setCfg(await api('/api/config/debate', { method: 'PUT', body: { ...cfg.debate, ...patch } })); } catch (e) { toast(e.message, 'error'); } };
  const saveObs = async patch => { try { setCfg(await api('/api/config/observability', { method: 'PUT', body: { ...cfg.observability, ...patch } })); } catch (e) { toast(e.message, 'error'); } };

  return <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
    <PageHeader icon="settings" tone="emerald" title="Settings" subtitle="Engines, per-agent routing and debate. Changes apply immediately, no restart needed." />
    <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <DemoCard />
      <LocalModelCard />
    </div>

    <Tabs tabs={[['engines', 'Engines', 'cpu'], ['routing', 'Routing', 'workflow'], ['debate', 'Debate', 'scale'], ['tracing', 'Tracing', 'activity']]} value={tab} onChange={setTab} className="mb-5 border-b border-zinc-800 pb-3" />
    {!cfg ? <p className="flex items-center gap-2 text-sm text-zinc-400"><Spinner />Loading</p> : <>
      {tab === 'engines' && <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-zinc-400">Each engine is one model at one endpoint. Agents pick engines in Routing.</p>
          <div className="flex gap-2">
            <button className="btn btn-secondary" onClick={testAll} disabled={testingAll}>{testingAll && <Spinner />}Test all</button>
            <AddEngine existing={Object.keys(cfg.profiles)} onAdded={changed} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Object.values(cfg.profiles).map(p => <EngineCard key={p.id} prof={p} onChanged={changed} testResult={tests[p.id]} />)}
        </div>
      </div>}

      {tab === 'routing' && <RoutingTable cfg={cfg} onSaved={d => { setCfg(d); window.dispatchEvent(new Event('cp:config')); }} />}

      {tab === 'debate' && <section className="card max-w-xl space-y-5 p-4">
        <div>
          <div className="flex items-baseline justify-between"><label htmlFor="maxr" className="text-sm font-medium text-zinc-100">Maximum rounds</label><span className="tabular-nums text-zinc-200">{cfg.debate.max_rounds}</span></div>
          <input id="maxr" type="range" min="1" max="6" value={cfg.debate.max_rounds} onChange={e => saveDebate({ max_rounds: +e.target.value, min_rounds: Math.min(cfg.debate.min_rounds, +e.target.value) })} className="mt-2 w-full accent-blue-500" />
          <p className="mt-1 text-xs text-zinc-400">1 is a single pass. Each extra round repeats the four agents with the Critic's feedback, so on a local model every round adds several minutes.</p>
        </div>
        <div>
          <div className="flex items-baseline justify-between"><label htmlFor="minr" className="text-sm font-medium text-zinc-100">Minimum rounds</label><span className="tabular-nums text-zinc-200">{cfg.debate.min_rounds}</span></div>
          <input id="minr" type="range" min="1" max={cfg.debate.max_rounds} value={cfg.debate.min_rounds} onChange={e => saveDebate({ min_rounds: +e.target.value })} className="mt-2 w-full accent-blue-500" />
        </div>
        <Switch checked={cfg.debate.consensus_required} onChange={v => saveDebate({ consensus_required: v })} label="Flag for review without consensus"
          description="Marks the note for human review when the Critic still disagrees after the last round." />
      </section>}

      {tab === 'tracing' && <section className="card max-w-xl space-y-4 p-4">
        <Switch checked={cfg.observability.sqlite} onChange={v => saveObs({ sqlite: v })} label="Keep history in SQLite" description="Observability survives server restarts (data/observability.db)." />
        <Switch checked={cfg.observability.langfuse} onChange={v => saveObs({ langfuse: v })} label="Send traces to Langfuse" description="Needs the Langfuse keys in .env." />
        <Switch checked={cfg.observability.langsmith} onChange={v => saveObs({ langsmith: v })} label="Send traces to LangSmith" description="Needs LANGSMITH_API_KEY in .env." />
        <p className="border-t border-zinc-800 pt-3 text-xs leading-relaxed text-zinc-400">To never be asked for keys, copy <code className="font-mono text-zinc-300">config/secrets.local.example.py</code> to <code className="font-mono text-zinc-300">config/secrets.local.py</code> and fill in <code className="font-mono text-zinc-300">HARDCODED_KEYS</code>, or put them in <code className="font-mono text-zinc-300">.env</code>.</p>
      </section>}
    </>}
  </div>;
}
