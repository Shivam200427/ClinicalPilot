import { Icon, Spinner, PageHeader, CardHead, Switch, useToast } from '../ui.jsx';
import { useSession } from '../session-store.jsx';

const { useEffect, useState } = React;

function Stat({ label, value, tone }) {
  return <div className="card px-4 py-3">
    <dt className="text-xs font-medium text-zinc-400">{label}</dt>
    <dd className={`mt-0.5 font-display text-2xl font-bold tabular-nums ${tone || 'text-white'}`}>{value}</dd>
  </div>;
}

function Breakdown({ title, data }) {
  const rows = Object.entries(data || {});
  return <section className="card" aria-label={title}>
    <div className="card-head"><h2 className="card-title">{title}</h2></div>
    {rows.length === 0 ? <p className="px-4 py-3 text-sm text-zinc-500">No data yet.</p> :
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-zinc-500">
          <th className="px-4 py-2 font-medium">Name</th><th className="px-2 py-2 text-right font-medium">Calls</th>
          <th className="px-2 py-2 text-right font-medium">Errors</th><th className="px-4 py-2 text-right font-medium">Avg</th>
        </tr></thead>
        <tbody>{rows.map(([k, v]) => <tr key={k} className="border-t border-zinc-800/70">
          <td className="max-w-0 truncate px-4 py-1.5 font-mono text-xs text-zinc-200" title={k}>{k}</td>
          <td className="px-2 py-1.5 text-right tabular-nums text-zinc-200">{v.calls}</td>
          <td className={`px-2 py-1.5 text-right tabular-nums ${v.errors ? 'text-rose-300' : 'text-zinc-500'}`}>{v.errors}</td>
          <td className="px-4 py-1.5 text-right tabular-nums text-zinc-400">{fmtMs(v.avg_latency_ms)}</td>
        </tr>)}</tbody>
      </table>}
  </section>;
}

const fmtMs = ms => ms == null ? '' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;

function TraceRow({ tr }) {
  const [open, setOpen] = useState(false);
  let msgs = []; try { msgs = JSON.parse(tr.request_json || '[]'); } catch {}
  let meta = null; try { meta = tr.meta_json ? JSON.parse(tr.meta_json) : null; } catch {}
  const pubmed = tr.provider === 'pubmed';
  const detail = msgs.length > 0 || tr.response_text || meta || tr.error;
  return <li className="border-t border-zinc-800/70">
    <button type="button" disabled={!detail} aria-expanded={open} onClick={() => setOpen(o => !o)}
      className={`grid w-full grid-cols-[16px_110px_110px_1fr_48px_64px_20px] items-center gap-2 px-4 py-2 text-left text-xs ${detail ? 'hover:bg-zinc-800/40' : ''}`}>
      <span className="text-zinc-500">{detail && <Icon name="chevRight" size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />}</span>
      <span className="truncate text-zinc-200">{tr.role}{pubmed ? ' (PubMed)' : ''}</span>
      <span className="truncate text-zinc-400">{tr.provider}</span>
      <span className="truncate font-mono text-zinc-300">{tr.model}</span>
      <span className="text-right tabular-nums text-zinc-500">{tr.debate_round ?? ''}</span>
      <span className="text-right tabular-nums text-zinc-400">{fmtMs(tr.latency_ms)}</span>
      <span className="text-right">{tr.success ? <Icon name="check" size={13} className="ml-auto text-emerald-400" /> : <Icon name="x" size={13} className="ml-auto text-rose-400" />}
        <span className="sr-only">{tr.success ? 'Succeeded' : 'Failed'}</span></span>
    </button>
    {open && <div className="space-y-3 px-4 pb-4 pl-10">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-400">
        <span>Tokens in/out <span className="font-mono text-zinc-200">{tr.tokens_in}/{tr.tokens_out}</span></span>
        {tr.request_id && <span>Run <span className="font-mono text-zinc-200">{tr.request_id}</span></span>}
        {tr.fallback_index > 0 && <span className="text-amber-300">Fallback engine #{tr.fallback_index}</span>}
      </div>
      {tr.error && <p className="rounded-md border border-rose-500/30 bg-rose-500/[.06] px-3 py-2 text-xs text-rose-200">{tr.error}</p>}
      {meta && <p className="text-xs text-zinc-300">{meta.source || 'Evidence'}{meta.hits != null ? `, ${meta.hits} results` : ''}</p>}
      {msgs.map((m, i) => <div key={i}>
        <h4 className="mb-1 text-xs font-medium capitalize text-zinc-400">{pubmed ? 'Query' : m.role}</h4>
        <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-300">{m.content}</pre>
      </div>)}
      {tr.response_text && <div>
        <h4 className="mb-1 text-xs font-medium text-zinc-400">{pubmed ? 'Results' : 'Response'}</h4>
        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200">{tr.response_text}</pre>
      </div>}
    </div>}
  </li>;
}

export function ObservabilityView() {
  const toast = useToast();
  const { obsSum: sum, obsTraces: traces, obsAuto: auto, setObsAuto: setAuto, obsError, loadObs: load, clearObs } = useSession();
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!auto) return; const iv = setInterval(load, 4000); return () => clearInterval(iv); }, [auto, load]);
  const clear = async () => { if (!confirm('Delete all recorded calls?')) return; await clearObs(); toast('History cleared', 'success'); };

  const actions = <>
    <div className="w-44"><Switch checked={auto} onChange={setAuto} label="Auto-refresh" /></div>
    <button className="btn btn-secondary btn-sm" onClick={load}><Icon name="refresh" size={13} />Refresh</button>
    <button className="btn btn-ghost btn-sm text-rose-300" onClick={clear}><Icon name="trash" size={13} />Clear</button>
  </>;

  if (!sum) return <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
    <PageHeader icon="activity" tone="emerald" title="Observability" subtitle="Every model call with its prompt, response, tokens and latency" />
    <p className="flex items-center gap-2 text-sm text-zinc-400">{obsError ? `Could not load: ${obsError}` : <><Spinner />Loading</>}</p>
  </div>;

  const rounds = sum.by_round || {};
  return <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
    <PageHeader icon="activity" tone="emerald" title="Observability" subtitle="Every model call with its prompt, response, tokens and latency" actions={actions} />

    <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Calls" value={sum.total_calls} />
      <Stat label="Succeeded" value={sum.success} tone="text-emerald-400" />
      <Stat label="Failed" value={sum.errors} tone={sum.errors ? 'text-rose-300' : undefined} />
      <Stat label="Error rate" value={`${Math.round((sum.error_rate || 0) * 100)}%`} tone={sum.error_rate > 0.2 ? 'text-rose-300' : undefined} />
      <Stat label="Tokens" value={(sum.total_tokens || 0).toLocaleString()} />
      <Stat label="Avg latency" value={fmtMs(sum.avg_latency_ms)} />
    </dl>

    <div className="mb-5 grid grid-cols-1 gap-5 md:grid-cols-3">
      <Breakdown title="By agent" data={sum.by_agent} />
      <Breakdown title="By provider" data={sum.by_provider} />
      <Breakdown title="By model" data={sum.by_model} />
    </div>

    {Object.keys(rounds).length > 1 && <div className="mb-5"><Breakdown title="By debate round" data={rounds} /></div>}

    <section className="card" aria-labelledby="calls-h">
      <CardHead id="calls-h" icon="terminal" tone="teal" title={`Recent calls (${traces.length})`} subtitle="Newest first. Select a row for the exact prompt and response." />
      {traces.length === 0 ? <p className="px-4 py-3 text-sm text-zinc-500">No calls yet. Run an analysis or send a chat message.</p> :
        <div className="overflow-x-auto"><div className="min-w-[680px]">
          <div className="grid grid-cols-[16px_110px_110px_1fr_48px_64px_20px] gap-2 px-4 py-2 text-xs text-zinc-500">
            <span /><span>Agent</span><span>Provider</span><span>Model</span><span className="text-right">Round</span><span className="text-right">Time</span><span />
          </div>
          <ul>{[...traces].reverse().map(tr => <TraceRow key={tr.id} tr={tr} />)}</ul>
        </div></div>}
    </section>
  </div>;
}
