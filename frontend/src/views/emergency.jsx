import { Icon, Spinner, MicBtn, CardHead, IconTile, asText } from '../ui.jsx';
import { useSession } from '../session-store.jsx';
import { fmtDate } from '../lib.js';

const ESI = {
  1: { label: 'Resuscitation', cls: 'bg-red-600' },
  2: { label: 'Emergent', cls: 'bg-orange-600' },
  3: { label: 'Urgent', cls: 'bg-amber-600' },
  4: { label: 'Less urgent', cls: 'bg-green-600' },
  5: { label: 'Non-urgent', cls: 'bg-blue-600' },
};

export function EmergencyView() {
  const { em, setEm, emBusy, runEmergency } = useSession();
  const r = em.result;
  const esi = ESI[r?.esi_score];
  return <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
    <div className="anim-fade-up mb-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight text-white">Emergency triage</h1>
      <p className="mt-1.5 text-sm text-zinc-400">Fast path that skips the debate. Returns an ESI level, red flags and first actions.</p>
    </div>

    <section className="card anim-fade-up border-rose-500/20 p-5">
      <label htmlFor="em-text" className="label">Presentation</label>
      <textarea id="em-text" value={em.input} onChange={e => setEm(s => ({ ...s, input: e.target.value }))} rows={4}
        placeholder="e.g. 60M, crushing chest pain 30 min, diaphoretic, BP 88/50"
        className="field resize-y border-2 border-rose-500/20 text-[15px] focus:border-rose-500/50 focus:ring-rose-500/10"
        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); runEmergency(); } }} />
      <div className="mt-3 flex items-center gap-2">
        <MicBtn onTranscript={t => setEm(s => ({ ...s, input: (s.input ? s.input + ' ' : '') + t }))} />
        {r && <button className="btn btn-ghost" onClick={() => setEm({ input: '', result: null, latency: null, at: null })}>Clear</button>}
      </div>
      <button className="btn-cta btn-cta-red mt-4 w-full py-3.5 text-lg" onClick={runEmergency} disabled={emBusy}>
        {emBusy ? <><Spinner />Triaging…</> : <><Icon name="zap" size={20} />Triage now</>}
      </button>
    </section>

    {r && <section className="card anim-fade-up mt-5" aria-labelledby="em-res">
      <CardHead id="em-res" icon="activity" tone="rose" title="Triage result">
        <span className="flex items-center gap-1 text-xs text-zinc-400"><Icon name="history" size={12} />{em.latency != null && `${em.latency.toFixed(1)}s`}{em.at ? ` · ${fmtDate(em.at)}` : ''}</span>
      </CardHead>
      <div className="space-y-5 p-4">
        <div className="flex items-center gap-4">
          <div className={`flex h-20 w-20 items-center justify-center rounded-2xl font-display text-4xl font-black text-white shadow-lg ${esi ? esi.cls : 'bg-zinc-700'}`} aria-hidden="true">{r.esi_score ?? '?'}</div>
          <div>
            <p className="font-display text-xl font-bold text-white">ESI {r.esi_score ?? 'not assigned'}{esi && <span className="font-normal text-zinc-400"> · {esi.label}</span>}</p>
            <p className="text-sm text-zinc-400">Emergency Severity Index, 1 is most urgent</p>
          </div>
        </div>

        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[.06] px-4 py-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400">Immediate action</h3>
          <p className="mt-1 text-[15px] font-medium text-zinc-50">{r.call_to_action || 'Immediate medical evaluation required'}</p>
        </div>

        {r.red_flags?.length > 0 && <div className="rounded-xl border border-rose-500/20 bg-rose-500/[.06] p-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-rose-400">Red flags</h3>
          <ul className="space-y-1.5">{r.red_flags.map((f, i) => <li key={i} className="flex gap-2 text-sm text-rose-200">
            <Icon name="alert" size={14} className="mt-0.5 text-rose-400" />{asText(f)}</li>)}</ul>
        </div>}

        {r.top_differentials?.length > 0 && <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-rose-400">Top differentials</h3>
          <ol className="space-y-1.5">{r.top_differentials.map((d, i) => {
            const name = typeof d === 'string' ? d : d.diagnosis || d.name;
            const lk = typeof d === 'string' ? '' : d.likelihood || d.confidence || '';
            return <li key={i} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm">
              <span className="text-zinc-100"><span className="mr-2 tabular-nums text-zinc-500">{i + 1}.</span>{name}</span>
              {lk && <span className="text-xs text-zinc-400">{String(lk)}</span>}
            </li>;
          })}</ol>
        </div>}

        {r.safety_flags?.length > 0 && <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-orange-400">Safety</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-orange-200">{r.safety_flags.map((f, i) => <li key={i}>{typeof f === 'string' ? f : f.description}</li>)}</ul>
        </div>}
      </div>
    </section>}
  </div>;
}
