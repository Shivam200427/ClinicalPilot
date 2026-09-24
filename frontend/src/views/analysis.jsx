import { API, api, cpFetch, fmtDuration, fmtClock, fmtDate, cleanModelText } from '../lib.js';
import { Icon, Spinner, MicBtn, Markdown, CardHead, IconTile, TONES, useToast, useNow } from '../ui.jsx';
import { useAnalysis, STEPS } from '../analysis-store.jsx';
import { SAMPLE_CASES, SAMPLE_FHIR, SAMPLE_CSV } from '../data.js';
import { ClinicalReport } from './report.jsx';

const { useState, useEffect, useRef, useCallback } = React;

/* Turn a parsed patient context from an upload into editable case text. */
function contextToText(c) {
  if (!c) return '';
  const lines = [];
  if (c.age || c.gender) lines.push(`${c.age ? `${c.age}-year-old` : ''} ${c.gender && c.gender !== 'unknown' ? c.gender : ''}`.trim());
  const list = (label, arr, f) => { if (arr?.length) lines.push(`${label}: ${arr.map(f).join(', ')}`); };
  list('Conditions', c.conditions, x => x.display || x.name || x);
  list('Medications', c.medications, x => [x.name || x, x.dose].filter(Boolean).join(' '));
  list('Allergies', c.allergies, x => x.substance || x);
  list('Labs', c.labs, x => `${x.name} ${x.value}${x.unit ? ' ' + x.unit : ''}`);
  list('Vitals', c.vitals, x => `${x.name} ${x.value}${x.unit ? ' ' + x.unit : ''}`);
  if (c.current_prompt) lines.push('', c.current_prompt);
  return lines.join('\n').trim();
}

/* ── Sample menu ── */
function SampleMenu({ onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const items = [...SAMPLE_CASES.map(c => ({ id: c.id, label: c.label, hint: 'Free text' })),
    { id: 'fhir', label: 'FHIR R4 bundle', hint: 'Parsed by the server' },
    { id: 'csv', label: 'EHR CSV export', hint: 'Parsed by the server' }];
  return <div className="relative" ref={ref}>
    <button type="button" className="btn btn-secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      Load sample <Icon name="chevDown" size={14} />
    </button>
    {open && <div role="menu" className="anim-fade-up absolute left-0 top-full z-30 mt-1.5 w-72 rounded-xl border border-zinc-700 bg-zinc-900 p-1 shadow-2xl">
      {items.map(it => <button key={it.id} role="menuitem" className="flex w-full items-baseline justify-between gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
        onClick={() => { setOpen(false); onPick(it.id); }}>
        <span>{it.label}</span><span className="text-xs text-zinc-500">{it.hint}</span>
      </button>)}
    </div>}
  </div>;
}

/* ── Case input ── */
function CaseInput() {
  const toast = useToast();
  const { input, setInput, busy, runAnalysis, stop, clear, log } = useAnalysis();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const ingest = useCallback(async (request, what) => {
    setUploading(true);
    try {
      const r = await request();
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.detail || `Could not parse ${what}`); }
      const d = await r.json();
      const text = d.summary || contextToText(d.patient_context);
      if (!text) throw new Error(`Nothing usable was found in ${what}`);
      setInput(text);
      toast(`Loaded ${what}`, 'success'); log('upload', `Loaded ${what}`);
    } catch (e) { toast(e.message, 'error'); }
    finally { setUploading(false); }
  }, [setInput, toast, log]);

  const onFile = e => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again
    if (!file) return;
    if (/\.json$/i.test(file.name)) {
      ingest(async () => cpFetch(`${API}/api/upload/fhir`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await file.text() }), file.name);
    } else {
      const fd = new FormData(); fd.append('file', file);
      ingest(() => cpFetch(`${API}/api/upload/ehr`, { method: 'POST', body: fd }), file.name);
    }
  };

  const pickSample = id => {
    const c = SAMPLE_CASES.find(x => x.id === id);
    if (c) { setInput(c.text); return; }
    if (id === 'fhir') ingest(() => cpFetch(`${API}/api/upload/fhir`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(SAMPLE_FHIR) }), 'the sample FHIR bundle');
    if (id === 'csv') {
      const fd = new FormData(); fd.append('file', new File([SAMPLE_CSV], 'sample_ehr.csv', { type: 'text/csv' }));
      ingest(() => cpFetch(`${API}/api/upload/ehr`, { method: 'POST', body: fd }), 'the sample CSV');
    }
  };

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  return <section className="card anim-fade-up" aria-labelledby="case-h">
    <CardHead id="case-h" icon="stethoscope" tone="blue" title="Clinical input" subtitle="Free text, voice dictation, or a patient file">
      <span className="text-xs text-zinc-500">{input.trim() ? `${input.trim().split(/\s+/).length} words` : ''}</span>
    </CardHead>
    <div className="p-5">
      <label htmlFor="case-text" className="sr-only">Clinical presentation</label>
      <textarea id="case-text" value={input} onChange={e => setInput(e.target.value)} rows={8} disabled={busy}
        placeholder={'Age and sex, chief complaint, history, medications, allergies, vitals, labs, exam findings.'}
        className="field resize-y px-4 py-3.5 text-[15px] leading-relaxed disabled:opacity-70"
        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); runAnalysis(); } }} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SampleMenu onPick={pickSample} />
        <RecentMenu />
        <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <Spinner /> : <Icon name="upload" size={14} />}Upload file
        </button>
        <input ref={fileRef} type="file" accept=".pdf,.csv,.json" className="hidden" onChange={onFile} aria-label="Upload a PDF, CSV or FHIR JSON file" />
        <MicBtn onTranscript={t => setInput(p => (p && !/\s$/.test(p) ? p + ' ' : p) + t)} />
        <div className="ml-auto flex items-center gap-2">
          <kbd className="hidden rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-400 sm:inline">{isMac ? '⌘' : 'Ctrl'} Enter</kbd>
          {busy
            ? <button className="btn btn-stop" onClick={stop}><Icon name="square" size={12} />Stop</button>
            : <button className="btn btn-ghost" onClick={clear} disabled={!input}><Icon name="trash" size={14} />Clear</button>}
          <button className="btn-cta" onClick={runAnalysis} disabled={busy}>
            {busy ? <><Spinner />Analyzing…</> : <><Icon name="play" size={15} />Run analysis</>}
          </button>
        </div>
      </div>
      <p className="mt-2 text-xs text-zinc-500">Uploads accept PDF or CSV records and FHIR R4 JSON bundles. Identifiers are removed before anything reaches a model.</p>
    </div>
  </section>;
}

/* ── Engines per role (for the run panel) ── */
function useEngines(deps) {
  const [roles, setRoles] = useState({});
  useEffect(() => { api('/api/config/effective').then(d => setRoles(d.roles || {})).catch(() => {}); }, deps); // eslint-disable-line
  return roles;
}

const STEP_STYLE = {
  parse: ['file', 'zinc'], clinical: ['stethoscope', 'blue'], literature: ['book', 'sky'], safety: ['shield', 'rose'],
  med_panel: ['pill', 'violet'], critic: ['scale', 'amber'], synthesizer: ['sparkles', 'emerald'],
};

function StepIcon({ step, status }) {
  const [icon] = STEP_STYLE[step] || ['circle'];
  const cls = status === 'active' ? 'border-brand-500/40 bg-brand-500/10 text-brand-300'
    : status === 'pending' ? 'border-zinc-800 bg-zinc-900 text-zinc-600' : 'border-zinc-700 bg-zinc-800 text-zinc-300';
  return <span className={`tile relative h-8 w-8 ${cls}`}>
    {status === 'active' ? <Spinner /> : <Icon name={icon} size={15} />}
    {status === 'done' && <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-zinc-950 ring-2 ring-zinc-900"><Icon name="check" size={10} strokeWidth={3} /></span>}
    {status === 'error' && <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-white ring-2 ring-zinc-900"><Icon name="x" size={10} strokeWidth={3} /></span>}
    {status === 'stopped' && <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-zinc-950 ring-2 ring-zinc-900"><Icon name="minus" size={10} strokeWidth={3} /></span>}
  </span>;
}

const STATUS_TEXT = { pending: 'Waiting', active: 'Running', done: 'Done', error: 'Failed', stopped: 'Stopped' };

/* ── Run panel: every step, its engine, its timing, and its live output ── */
function RunPanel({ collapsible }) {
  const { run, busy, stop, reconnect } = useAnalysis();
  const now = useNow(busy);
  const engines = useEngines([run.id]);
  const [pick, setPick] = useState(null);
  const [open, setOpen] = useState(!collapsible);
  const outRef = useRef(null);
  useEffect(() => { setOpen(!collapsible); }, [collapsible]);
  useEffect(() => { if (busy) setPick(null); }, [run.id, busy]);

  // Follow the most recently started step that has output, unless the user picked one.
  const auto = STEPS.filter(s => run.live[s.key] || run.data[s.key])
    .sort((a, b) => (run.steps[b.key]?.start || 0) - (run.steps[a.key]?.start || 0))[0]?.key;
  const shown = pick || auto;
  const liveText = cleanModelText(run.live[shown] || '');
  const shownData = run.data[shown];
  const streaming = run.steps[shown]?.status === 'active';

  useEffect(() => {
    const el = outRef.current;
    if (el && streaming) el.scrollTop = el.scrollHeight;
  }, [liveText, streaming]);

  const end = run.ended || now;
  const total = run.started ? (end - run.started) / 1000 : null;
  const headline = {
    running: `Running · ${fmtDuration(total)}`,
    done: `Finished in ${fmtDuration(total)}`,
    stopped: `Stopped after ${fmtDuration(total)}`,
    error: 'Failed',
    lost: 'Connection lost',
  }[run.status] || '';
  const doneCount = STEPS.filter(s => run.steps[s.key]?.status === 'done').length;

  const pill = run.status === 'error' || run.status === 'lost' ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
    : run.status === 'stopped' ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
      : run.status === 'done' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-brand-500/30 bg-brand-500/10 text-brand-300';
  return <section className="card anim-fade-up" aria-labelledby="run-h" aria-busy={busy}>
    <div className="card-head">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Icon name="activity" size={16} className="text-zinc-400" />
        <h2 id="run-h" className="card-title">{run.mode === 'feedback' ? 'Re-analysis' : 'Live pipeline'}</h2>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums ${pill}`} aria-live="polite">{headline}</span>
        {run.maxRounds > 1 && run.round > 0 && <span className="text-xs text-zinc-400">Round {run.round} of {run.maxRounds}</span>}
      </div>
      <div className="flex items-center gap-2">
        {busy && <button className="btn btn-stop btn-sm" onClick={stop}><Icon name="square" size={11} />Stop</button>}
        {run.status === 'lost' && run.id && <button className="btn btn-secondary btn-sm" onClick={reconnect}><Icon name="refresh" size={13} />Reconnect</button>}
        {collapsible && <button className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          {open ? 'Hide details' : `Details (${doneCount}/${STEPS.length})`}
        </button>}
      </div>
    </div>

    {run.error && <div className="flex gap-2 border-b border-zinc-800 bg-rose-500/[.06] px-4 py-2.5 text-sm text-rose-200" role="alert">
      <Icon name="alert" size={15} className="mt-0.5 text-rose-400" /><span className="break-words">{run.error}</span>
    </div>}

    {open && <>
      <ol className="space-y-1 p-2">
        {STEPS.map(s => {
          const st = run.steps[s.key] || { status: 'pending' };
          const eng = s.role && engines[s.role];
          const dur = st.start ? ((st.end || (st.status === 'active' ? now : st.start)) - st.start) / 1000 : null;
          const hasOut = !!(run.live[s.key] || run.data[s.key]);
          const selected = shown === s.key && hasOut;
          return <li key={s.key}>
            <button type="button" disabled={!hasOut} onClick={() => setPick(s.key)} aria-pressed={selected}
              className={`grid w-full grid-cols-[32px_1fr_auto] items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition ${st.status === 'active' ? 'border-brand-500/30 bg-brand-500/[.06]' : selected ? 'border-zinc-700 bg-zinc-800/50' : 'border-transparent'} ${hasOut ? 'hover:bg-zinc-800/50' : 'cursor-default'}`}>
              <StepIcon step={s.key} status={st.status} />
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className={`font-medium ${st.status === 'pending' ? 'text-zinc-500' : 'text-white'}`}>{s.label}</span>
                {eng && <span className="truncate text-xs text-zinc-500">{eng.label}</span>}
                {st.consensus === false && <span className="text-xs text-amber-300">dissent</span>}
                <span className="sr-only">{STATUS_TEXT[st.status]}</span>
              </span>
              <span className={`text-xs tabular-nums ${st.status === 'active' ? 'text-brand-300' : 'text-zinc-400'}`}>{dur != null ? fmtDuration(dur) : st.status === 'pending' && busy ? 'Queued' : ''}</span>
            </button>
          </li>;
        })}
      </ol>

      {shown && (liveText || shownData) && <div className="border-t border-zinc-800">
        <div className="flex items-center justify-between px-4 pt-3">
          <h3 className="flex items-center gap-2 text-xs font-semibold text-zinc-300">{streaming && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" aria-hidden="true" />}{STEPS.find(s => s.key === shown)?.label} output{streaming ? ', writing' : ''}</h3>
          {engines[shown]?.model && <span className="font-mono text-xs text-zinc-500">{engines[shown].model}</span>}
        </div>
        <pre ref={outRef} className="mx-4 mb-4 mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-zinc-800 bg-zinc-950/80 px-3.5 py-3 font-mono text-xs leading-relaxed text-zinc-300">
          {liveText || JSON.stringify(shownData, null, 2)}
        </pre>
      </div>}
      {busy && !shown && <p className="border-t border-zinc-800 px-4 py-3 text-xs text-zinc-500">
        Model output appears here as it is written. Local models can take a minute or more per step.
      </p>}
    </>}
  </section>;
}

/* ── Partial results when a run fails or is stopped ── */
function PartialResults() {
  const { run } = useAnalysis();
  const d = run.data;
  const c = d.clinical, l = d.literature, s = d.safety, m = d.med_panel, k = d.critic;
  if (!c && !l && !s && !m && !k) return null;
  const Section = ({ title, children }) => <div className="border-t border-zinc-800 px-4 py-3 first:border-t-0">
    <h3 className="mb-2 text-sm font-semibold text-zinc-100">{title}</h3>{children}
  </div>;
  const medAlerts = m ? [...(m.drug_interactions || []).map(x => `${x.drug_a} + ${x.drug_b}: ${x.description}`),
    ...(m.contraindications || []).map(x => `${x.drug} in ${x.disease}: ${x.description}`),
    ...(m.dosing_alerts || []).map(x => `${x.drug}: ${x.description}`),
    ...(m.population_flags || []).map(x => `${x.drug} (${x.population}): ${x.description}`)] : [];
  return <section className="card anim-fade-up border-amber-500/20" aria-labelledby="partial-h">
    <CardHead id="partial-h" icon="layers" tone="amber" title="Partial results" subtitle="From the steps that finished before the run ended" />
    <div>
      {c && <Section title="Clinical">
        {c.differentials?.length > 0 && <ol className="mb-2 list-decimal space-y-1 pl-5 text-sm text-zinc-200">
          {c.differentials.map((x, i) => <li key={i}><span className="font-medium">{x.diagnosis}</span>
            {(x.likelihood || x.confidence) && <span className="text-zinc-400"> ({x.likelihood || x.confidence})</span>}
            {x.reasoning && <span className="block text-zinc-400">{x.reasoning}</span>}</li>)}
        </ol>}
        {c.soap_draft && <Markdown text={c.soap_draft} className="text-sm text-zinc-300" />}
      </Section>}
      {l && (l.summary || l.evidence?.length > 0) && <Section title="Literature">
        {l.summary && <Markdown text={l.summary} className="text-sm text-zinc-300" />}
        {l.evidence?.length > 0 && <ul className="mt-2 space-y-1 text-sm text-zinc-300">{l.evidence.map((e, i) => <li key={i}>
          {e.pmid ? <a className="text-brand-300 underline underline-offset-2" href={`https://pubmed.ncbi.nlm.nih.gov/${e.pmid}/`} target="_blank" rel="noopener noreferrer">{e.title}</a> : e.title}
          {e.year && <span className="text-zinc-500"> ({e.year})</span>}</li>)}</ul>}
      </Section>}
      {s && (s.flags?.length > 0 || s.medication_review) && <Section title="Safety">
        {s.flags?.length > 0 && <ul className="space-y-1 text-sm text-zinc-300">{s.flags.map((f, i) => <li key={i}><span className="text-amber-300">{f.severity}</span> {f.description}</li>)}</ul>}
        {s.medication_review && <Markdown text={s.medication_review} className="mt-2 text-sm text-zinc-300" />}
      </Section>}
      {medAlerts.length > 0 && <Section title="Medication check">
        <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-300">{medAlerts.map((a, i) => <li key={i}>{a}</li>)}</ul>
      </Section>}
      {k?.overall_assessment && <Section title="Critic"><Markdown text={k.overall_assessment} className="text-sm text-zinc-300" /></Section>}
    </div>
  </section>;
}

/* ── Recent cases menu (saved in this browser) ── */
function RecentMenu() {
  const { history, openHistory, removeHistory, res } = useAnalysis();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return <div className="relative" ref={ref}>
    <button type="button" className="btn btn-secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      <Icon name="history" size={14} />Recent{history.length > 0 && <span className="text-zinc-500">{history.length}</span>}
    </button>
    {open && <div role="menu" className="absolute left-0 top-full z-30 mt-1.5 w-80 rounded-xl border border-zinc-700 bg-zinc-900 p-1 shadow-2xl">
      {history.length === 0
        ? <p className="px-3 py-2.5 text-sm text-zinc-500">Finished analyses are saved here, in this browser.</p>
        : <ul className="max-h-80 overflow-y-auto">{history.map(h => <li key={h.id} className={`group flex items-start gap-1 rounded-lg ${res?.request_id === h.id ? 'bg-zinc-800/70' : 'hover:bg-zinc-800'}`}>
          <button role="menuitem" className="min-w-0 flex-1 px-3 py-2 text-left" onClick={() => { setOpen(false); openHistory(h); }}>
            <span className="block truncate text-sm text-zinc-200">{h.title}</span>
            <span className="text-xs text-zinc-500">{fmtDate(h.at)}{h.mode === 'feedback' ? ' · with feedback' : ''}</span>
          </button>
          <button className="m-1 rounded-md p-1.5 text-zinc-500 opacity-0 hover:bg-zinc-700 hover:text-zinc-200 focus:opacity-100 group-hover:opacity-100" aria-label={`Remove ${h.title}`} onClick={() => removeHistory(h.id)}><Icon name="x" size={12} /></button>
        </li>)}</ul>}
    </div>}
  </div>;
}

const SRC_TONE = { error: 'text-rose-400', agent: 'text-violet-400', pipeline: 'text-cyan-400', upload: 'text-emerald-400', system: 'text-brand-400' };
function ActivityCard() {
  const { logs } = useAnalysis();
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [logs]);
  return <section className="card anim-fade-up" aria-labelledby="act-h">
    <CardHead id="act-h" icon="terminal" title="Activity" />
    <div ref={ref} className="max-h-64 overflow-y-auto px-4 py-3 font-mono" role="log" aria-live="off">
      {logs.length === 0 ? <p className="text-xs text-zinc-500">$ waiting for a case…</p>
        : <ul className="space-y-1">{logs.map((l, i) => <li key={i} className="grid grid-cols-[58px_62px_1fr] gap-2 text-[11.5px]">
          <span className="tabular-nums text-zinc-500">{fmtClock(l.t || Date.now())}</span>
          <span className={SRC_TONE[l.src] || 'text-brand-400'}>{l.src}</span>
          <span className="break-words text-zinc-300">{l.msg}</span>
        </li>)}</ul>}
    </div>
  </section>;
}

function SafetyFlagsCard({ soap }) {
  const flags = soap?.safety_flags || [];
  if (!flags.length) return null;
  return <section className="card anim-fade-up border-amber-500/20 bg-amber-500/[.04]" aria-labelledby="sf-h">
    <CardHead id="sf-h" icon="alert" tone="amber" title="Safety flags" />
    <ul className="space-y-2 px-5 py-3">{flags.map((f, i) => <li key={i} className="border-l-2 border-amber-500/30 pl-3 text-sm text-amber-100/90">{typeof f === 'string' ? f : f.description || JSON.stringify(f)}</li>)}</ul>
  </section>;
}

export function AnalysisView() {
  const { run, res } = useAnalysis();
  const soap = res?.soap || null;
  const showRun = run.status !== 'idle';
  const failed = ['error', 'stopped', 'lost'].includes(run.status);
  return <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-5 px-4 py-6 sm:px-6 lg:grid-cols-12">
    <div className="space-y-5 lg:col-span-8">
      <CaseInput />
      {showRun && <RunPanel collapsible={!!soap && run.status === 'done'} />}
      {failed && (!soap || run.mode === 'feedback') && <PartialResults />}
      {soap && <ClinicalReport />}
    </div>
    <aside className="space-y-5 lg:col-span-4" aria-label="Case sidebar">
      <SafetyFlagsCard soap={soap} />
      <ActivityCard />
    </aside>
  </div>;
}
