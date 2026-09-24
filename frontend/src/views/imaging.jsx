import { Icon, IconTile, PageHeader } from '../ui.jsx';
import { usePersisted } from '../lib.js';
import { CLASSIFIERS } from '../data.js';

export function ImagingView() {
  const [sel, setSel] = usePersisted('imaging.sel', null);
  const c = CLASSIFIERS.find(x => x.id === sel);
  if (c) return <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
    <PageHeader icon={c.icon} tone={c.tone} title={c.name} subtitle={c.desc} actions={<>
      <a className="btn btn-secondary" href={c.url} target="_blank" rel="noopener noreferrer"><Icon name="ext" size={14} />Open in new tab</a>
      <button className="btn btn-secondary" onClick={() => setSel(null)}>Back to models</button>
    </>} />
    <iframe title={c.name} src={c.url} className="h-[78vh] w-full rounded-2xl border border-zinc-800 bg-zinc-900"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups" loading="lazy" />
    <p className="mt-2 text-xs text-zinc-500">Hosted on Streamlit Community Cloud. If the frame is blank, the app may be waking up; give it a minute or open it in a new tab.</p>
  </div>;

  return <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
    <PageHeader icon="microscope" tone="violet" title="Medical imaging AI" subtitle="Image classifiers hosted on Streamlit, running outside ClinicalPilot" />
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {CLASSIFIERS.map((cl, i) => <li key={cl.id} className="card anim-fade-up group flex items-center justify-between gap-3 p-5 transition hover:border-brand-500/25" style={{ animationDelay: `${i * 0.05}s` }}>
        <div className="flex min-w-0 items-center gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white transition group-hover:text-brand-300">{cl.name}</h2>
            <p className="mt-0.5 text-sm text-zinc-400">{cl.desc}</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button className="btn btn-secondary btn-sm" onClick={() => setSel(cl.id)}>Open here</button>
          <a className="btn btn-ghost btn-sm" href={cl.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${cl.name} in a new tab`}><Icon name="ext" size={14} /></a>
        </div>
      </li>)}
    </ul>
  </div>;
}
