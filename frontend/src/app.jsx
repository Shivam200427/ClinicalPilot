import { api, setKeyPrompt } from './lib.js';
import { Icon, Logo, Spinner, Dialog, ToastProvider, useToast } from './ui.jsx';
import { AnalysisProvider, useAnalysis } from './analysis-store.jsx';
import { SessionProvider } from './session-store.jsx';
import { AnalysisView } from './views/analysis.jsx';
import { EmergencyView } from './views/emergency.jsx';
import { ToolsView } from './views/tools.jsx';
import { ImagingView } from './views/imaging.jsx';
import { ArchitectureView } from './views/architecture.jsx';
import { ChatView } from './views/chat.jsx';
import { ObservabilityView } from './views/observability.jsx';
import { SettingsView } from './views/settings.jsx';

const { useState, useEffect, useCallback } = React;

const NAV = [
  ['analysis', 'Analysis', AnalysisView, 'stethoscope'],
  ['emergency', 'Emergency', EmergencyView, 'zap'],
  ['tools', 'Tools', ToolsView, 'wrench'],
  ['imaging', 'Imaging AI', ImagingView, 'microscope'],
  ['architecture', 'Architecture', ArchitectureView, 'workflow'],
  ['chat', 'AI Assistant', ChatView, 'message'],
  ['observability', 'Observability', ObservabilityView, 'activity'],
];
const VIEWS = Object.fromEntries([...NAV.map(([id, , C]) => [id, C]), ['settings', SettingsView]]);
const TITLES = Object.fromEntries([...NAV.map(([id, l]) => [id, l]), ['settings', 'Settings']]);

// View lives in the URL hash so refresh and the back button keep your place.
function useHashView() {
  const read = () => { const h = location.hash.replace(/^#\/?/, ''); return VIEWS[h] ? h : 'analysis'; };
  const [view, setView] = useState(read);
  useEffect(() => {
    const on = () => setView(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => { document.title = `${TITLES[view]} · ClinicalPilot`; }, [view]);
  const go = useCallback(id => { if (location.hash !== `#/${id}`) location.hash = `/${id}`; window.scrollTo(0, 0); }, []);
  return [view, go];
}

function useServerStatus() {
  const [st, setSt] = useState({ online: null, demo: false, engine: '' });
  useEffect(() => {
    let alive = true;
    const check = () => api('/api/config-status')
      .then(d => alive && setSt({ online: true, demo: !!d.demo, engine: d.engine_label }))
      .catch(() => alive && setSt(s => ({ ...s, online: false })));
    check();
    const iv = setInterval(check, 30000);
    window.addEventListener('cp:config', check);
    return () => { alive = false; clearInterval(iv); window.removeEventListener('cp:config', check); };
  }, []);
  return st;
}

function Navbar({ view, go }) {
  const [open, setOpen] = useState(false);
  const { busy, stop, run } = useAnalysis();
  const status = useServerStatus();
  useEffect(() => { setOpen(false); }, [view]);
  // Demo mode is deliberately not surfaced here; it is only visible in Settings.
  const statusText = status.online === false ? 'Offline' : status.online ? 'Online' : 'Connecting';
  const dot = status.online === false ? 'bg-rose-500' : status.online ? 'bg-emerald-500' : 'bg-zinc-500';

  const link = ([id, label, , icon]) => <a key={id} href={`#/${id}`} aria-current={view === id ? 'page' : undefined}
    className={`tab-pill flex items-center gap-2 whitespace-nowrap ${id === 'emergency' && view !== id ? '!text-rose-400 hover:!text-rose-300' : ''}`}>
    <Icon name={icon} size={15} />{label}</a>;

  return <header className="sticky top-0 z-40 border-b border-zinc-800/80" style={{ background: 'rgba(9,9,11,.88)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
    <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-4 sm:px-6">
      <a href="#/analysis" className="flex shrink-0 items-center gap-3" aria-label="ClinicalPilot home">
        <Logo size={30} />
        <span className="hidden sm:block">
          <span className="block font-display text-[17px] font-bold leading-none tracking-tight text-white">ClinicalPilot</span>
          <span className="mt-1 block text-[11px] font-medium text-zinc-500">AI Decision Support</span>
        </span>
      </a>
      <nav className="ml-2 hidden items-center gap-1 xl:flex" aria-label="Main">{NAV.map(link)}</nav>

      <div className="ml-auto flex items-center gap-2">
        {busy && <div className="flex items-center gap-1.5 rounded-full border border-brand-500/40 bg-brand-500/10 py-1 pl-2.5 pr-1 text-xs">
          <a href="#/analysis" className="flex items-center gap-1.5 font-semibold text-brand-300 hover:text-brand-200"><Spinner /><span className="hidden sm:inline">{run.mode === 'feedback' ? 'Re-analyzing' : 'Analyzing'}</span></a>
          <button className="flex h-6 w-6 items-center justify-center rounded-full text-rose-300 transition hover:bg-rose-500/25" onClick={stop} aria-label="Stop analysis" title="Stop"><Icon name="square" size={11} /></button>
        </div>}
        <span className="hidden items-center gap-1.5 text-xs text-zinc-400 sm:flex" title={status.engine ? `Default engine: ${status.engine}` : undefined}>
          <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />{statusText}
        </span>
        <a href="#/settings" aria-current={view === 'settings' ? 'page' : undefined} aria-label="Settings" title="Settings"
          className={`flex items-center rounded-xl border px-2.5 py-1.5 transition ${view === 'settings' ? 'border-brand-500/30 bg-brand-500/10 text-brand-300' : 'border-zinc-700/60 bg-zinc-800/40 text-zinc-400 hover:border-zinc-600 hover:text-brand-300'}`}><Icon name="settings" size={16} /></a>
        <button className="btn btn-ghost p-2 xl:hidden" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls="mobile-nav" aria-label="Menu"><Icon name={open ? 'x' : 'menu'} size={18} /></button>
      </div>
    </div>
    {open && <nav id="mobile-nav" className="grid grid-cols-2 gap-1 border-t border-zinc-800/60 px-4 py-3 xl:hidden" aria-label="Main">{NAV.map(link)}</nav>}
  </header>;
}

const KEY_LINKS = { GROQ_API_KEY: ['Groq', 'https://console.groq.com/keys'], OPENAI_API_KEY: ['OpenAI', 'https://platform.openai.com/api-keys'], ANTHROPIC_API_KEY: ['Anthropic', 'https://console.anthropic.com/settings/keys'] };
function KeyDialog({ state, onClose, go }) {
  const toast = useToast();
  const [val, setVal] = useState('');
  const [saving, setSaving] = useState(false);
  const link = KEY_LINKS[state.keyRef];
  const title = { rate_limit: 'Rate limit reached', invalid: 'Key rejected' }[state.reason] || 'API key needed';
  const desc = {
    rate_limit: <>The key in <code className="font-mono text-zinc-200">{state.keyRef}</code> hit its rate limit. Add another key to continue.</>,
    invalid: <>The key in <code className="font-mono text-zinc-200">{state.keyRef}</code> was rejected. It may be expired.</>,
  }[state.reason] || <>The engine <span className="text-zinc-200">{state.profile}</span> needs <code className="font-mono text-zinc-200">{state.keyRef}</code>.</>;
  const save = async () => {
    if (!val.trim()) return;
    setSaving(true);
    try { await api('/api/config/secret', { method: 'POST', body: { key_ref: state.keyRef, value: val.trim() } }); toast('Key saved. Run it again.', 'success'); window.dispatchEvent(new Event('cp:config')); onClose(); }
    catch (e) { toast(e.message, 'error'); } finally { setSaving(false); }
  };
  return <Dialog title={title} description={desc} onClose={onClose} footer={<>
    <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
    <button className="btn btn-primary" onClick={save} disabled={saving || !val.trim()}>{saving && <Spinner />}Save key</button>
  </>}>
    <label htmlFor="key-in" className="label">{state.keyRef}</label>
    <input id="key-in" type="password" autoComplete="off" className="field" value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} placeholder="Paste key" />
    {link && <a className="mt-2 inline-flex items-center gap-1 text-sm text-brand-300 hover:text-brand-200" href={link[1]} target="_blank" rel="noopener noreferrer">Get a {link[0]} key <Icon name="ext" size={12} /></a>}
    <p className="mt-3 text-xs leading-relaxed text-zinc-400">Kept in server memory until restart. To use a different provider or a local model instead, <button className="text-zinc-200 underline underline-offset-2" onClick={() => { onClose(); go('settings'); }}>open Settings</button>.</p>
  </Dialog>;
}

function Shell() {
  const [view, go] = useHashView();
  const [keyReq, setKeyReq] = useState(null);
  useEffect(() => { setKeyPrompt((keyRef, profile, reason) => setKeyReq({ keyRef, profile, reason })); return () => setKeyPrompt(null); }, []);
  const View = VIEWS[view];
  return <div className="flex min-h-screen flex-col">
    <a href="#main" className="skip-link" onClick={e => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
    <Navbar view={view} go={go} />
    {keyReq && <KeyDialog state={keyReq} onClose={() => setKeyReq(null)} go={go} />}
    <main id="main" tabIndex={-1} className="flex-1 outline-none"><View /></main>
    {view !== 'chat' && <footer className="border-t border-zinc-800/60 py-4 text-center text-xs text-zinc-500">ClinicalPilot · Multi-agent clinical decision support · For research and education only</footer>}
  </div>;
}

export function App() {
  return <ToastProvider>
    <AnalysisProvider>
      <SessionProvider>
        <Shell />
      </SessionProvider>
    </AnalysisProvider>
  </ToastProvider>;
}
