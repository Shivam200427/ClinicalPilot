import { CDN, loadScript, usePersisted } from '../lib.js';
import { PageHeader, Tabs, Spinner } from '../ui.jsx';
import { ARCH_DIAGRAM, FLOW_DIAGRAM } from '../data.js';

const { useEffect, useRef, useState } = React;

let mermaidReady = null;
function getMermaid() {
  if (!mermaidReady) {
    mermaidReady = loadScript(CDN.mermaid).then(() => {
      window.mermaid.initialize({
        startOnLoad: false, theme: 'base', securityLevel: 'strict',
        themeVariables: {
          background: 'transparent', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '13px',
          primaryColor: '#18181b', primaryTextColor: '#fafafa', primaryBorderColor: '#3b82f6',
          lineColor: '#52525b', secondaryColor: '#27272a', tertiaryColor: '#18181b',
          clusterBkg: 'rgba(24,24,27,.5)', clusterBorder: 'rgba(59,130,246,.35)', titleColor: '#93c5fd',
          actorBkg: '#18181b', actorBorder: '#3f3f46', actorTextColor: '#e4e4e7', actorLineColor: '#3f3f46',
          signalColor: '#a1a1aa', signalTextColor: '#e4e4e7', noteBkgColor: '#1e293b', noteTextColor: '#e4e4e7', noteBorderColor: '#334155',
          labelBoxBkgColor: '#18181b', labelBoxBorderColor: '#3f3f46', labelTextColor: '#e4e4e7', loopTextColor: '#a1a1aa',
        },
      });
      return window.mermaid;
    }).catch(e => { mermaidReady = null; throw e; });
  }
  return mermaidReady;
}

const STACK = [
  ['AI and reasoning', ['LiteLLM gateway, any provider or model', 'Per-agent routing with fallbacks', 'Clinical, Literature, Safety and Critic agents', 'Clinician feedback re-review']],
  ['Safety and data', ['Presidio PHI anonymization', 'PubMed E-utilities evidence', 'Medication error panel', 'RxNorm, DrugBank and openFDA lookups']],
  ['Infrastructure', ['FastAPI with resumable WebSocket runs', 'React 18 UI, prebuilt with esbuild and Tailwind', 'Observability in SQLite', 'Pydantic v2 validation']],
];

export function ArchitectureView() {
  const [tab, setTab] = usePersisted('arch.tab', 'system');
  const [state, setState] = useState('loading');
  const ref = useRef(null);
  useEffect(() => {
    let alive = true;
    setState('loading');
    getMermaid()
      .then(m => m.render(`mm-${tab}-${Date.now()}`, tab === 'system' ? ARCH_DIAGRAM : FLOW_DIAGRAM))
      .then(({ svg }) => { if (alive && ref.current) { ref.current.innerHTML = svg; setState('ok'); } })
      .catch(() => alive && setState('error'));
    return () => { alive = false; };
  }, [tab]);

  return <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
    <PageHeader icon="workflow" tone="blue" title="System architecture" subtitle="Multi-agent pipeline with debate-driven reasoning" />
    <Tabs tabs={[['system', 'System overview'], ['flow', 'Request flow']]} value={tab} onChange={setTab} className="mb-4" />
    <section className="card anim-fade-up overflow-x-auto p-5 sm:p-6">
      {state === 'loading' && <div className="flex items-center gap-2 py-16 text-sm text-zinc-400"><Spinner />Rendering diagram</div>}
      {state === 'error' && <p className="py-16 text-sm text-zinc-400">The diagram library could not be loaded. Check your connection and reopen this page.</p>}
      <div ref={ref} className={`[&_svg]:mx-auto [&_svg]:max-w-full ${state === 'ok' ? '' : 'hidden'}`} role="img"
        aria-label={tab === 'system' ? 'System overview diagram' : 'Request flow sequence diagram'} />
    </section>
    <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-3">
      {STACK.map(([title, items], i) => <section key={title} className="card anim-fade-up p-5" style={{ animationDelay: `${i * 0.06}s` }}>
        <h2 className={`mb-3 font-display text-sm font-bold ${['text-sky-400', 'text-rose-400', 'text-brand-400'][i]}`}>{title}</h2>
        <ul className="list-disc space-y-1 pl-4 text-sm text-zinc-400 marker:text-zinc-600">{items.map(i => <li key={i}>{i}</li>)}</ul>
      </section>)}
    </div>
  </div>;
}
