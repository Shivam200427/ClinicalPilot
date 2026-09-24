import { CDN, loadScript, copyText, soapToText, wordDiff, fmtDateTime } from '../lib.js';
import { Icon, Spinner, MicBtn, Markdown, CardHead, Logo, asText, useToast } from '../ui.jsx';
import { useAnalysis } from '../analysis-store.jsx';

const { useState, useRef, useMemo, useEffect } = React;

const SECTIONS = [
  { key: 'subjective', label: 'Subjective', hint: 'History and complaint', tag: 'S', color: '#2563eb' },
  { key: 'objective', label: 'Objective', hint: 'Exam, vitals and labs', tag: 'O', color: '#059669' },
  { key: 'assessment', label: 'Assessment', hint: 'Clinical impression', tag: 'A', color: '#d97706' },
  { key: 'plan', label: 'Plan', hint: 'Management', tag: 'P', color: '#7c3aed' },
];

function Diff({ before, after }) {
  const parts = useMemo(() => wordDiff(asText(before), asText(after)), [before, after]);
  return <div className="whitespace-pre-wrap">{parts.map((p, i) =>
    p.type === 'ins' ? <ins key={i} className="diff-ins">{p.text}</ins>
      : p.type === 'del' ? <del key={i} className="diff-del">{p.text}</del>
        : <span key={i}>{p.text}</span>)}</div>;
}

function AutoTextarea({ value, onChange, label }) {
  const ref = useRef(null);
  useEffect(() => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 4 + 'px'; } }, [value]);
  return <textarea ref={ref} aria-label={label} className="field-paper" value={value} onChange={e => onChange(e.target.value)} />;
}

const Meta = ({ label, value, mono }) => <div className="min-w-0">
  <dt className="doc-label">{label}</dt>
  <dd className={`mt-0.5 truncate text-[13.5px] text-gray-900 ${mono ? 'font-mono text-[12.5px]' : ''}`} title={String(value)}>{value}</dd>
</div>;

const DocSection = ({ n, title, note, children }) => <section className="mt-8">
  <h3 className="doc-h"><span className="num">{n}.</span>{title}{note && <span className="ml-auto text-[10.5px] font-medium normal-case tracking-normal text-emerald-700">{note}</span>}</h3>
  {children}
</section>;

export function ClinicalReport() {
  const toast = useToast();
  const { res, completedAt, prevSoap, edited, updateSoap, sendFeedback, busy, run } = useAnalysis();
  const soap = res?.soap;
  const debate = res?.debate || {};
  const med = res?.med_error_panel || {};
  const [editing, setEditing] = useState(false);
  const [showDiff, setShowDiff] = useState(true);
  const [fb, setFb] = useState('');
  const [exporting, setExporting] = useState(false);
  const paperRef = useRef(null);

  useEffect(() => { setShowDiff(true); }, [prevSoap]);
  if (!soap) return null;

  const conf = String(soap.uncertainty || 'medium').toLowerCase();
  const changed = prevSoap ? SECTIONS.filter(s => asText(prevSoap[s.key]) !== asText(soap[s.key])) : [];
  const diffOn = !!prevSoap && showDiff && !editing;
  const refining = busy && run.mode === 'feedback';

  const ints = med.drug_interactions || [], contras = med.contraindications || [];
  const dosing = med.dosing_alerts || [], pops = med.population_flags || [];
  const alertCount = ints.length + contras.length + dosing.length + pops.length;
  let secNo = SECTIONS.length;
  const next = () => ++secNo; // sections after S/O/A/P are numbered only when present
  const dissent = soap.dissent_log?.length ? soap.dissent_log : (debate.dissent_log || []);

  const exportPdf = async () => {
    setExporting(true);
    try {
      await loadScript(CDN.html2pdf);
      await window.html2pdf().set({
        margin: [10, 10], filename: `ClinicalPilot_${new Date(completedAt || Date.now()).toISOString().slice(0, 10)}.pdf`,
        image: { type: 'jpeg', quality: 0.96 }, html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }, pagebreak: { mode: ['css', 'legacy'] },
      }).from(paperRef.current).save();
    } catch (e) { toast(e.message || 'PDF export failed', 'error'); }
    finally { setExporting(false); }
  };
  const copy = async () => toast((await copyText(soapToText(soap))) ? 'Note copied' : 'Copy failed', 'info');
  const submitFeedback = () => {
    if (!fb.trim()) return;
    if (sendFeedback(fb.trim())) setFb('');
  };

  return <div className="space-y-4">
    <div className="no-print flex flex-wrap items-center gap-2">
      <button className="btn btn-secondary" onClick={exportPdf} disabled={exporting}>{exporting ? <Spinner /> : <Icon name="download" size={14} />}PDF</button>
      <button className="btn btn-secondary" onClick={() => window.print()}><Icon name="printer" size={14} />Print</button>
      <button className="btn btn-secondary" onClick={copy}><Icon name="copy" size={14} />Copy</button>
      <button className={`btn ${editing ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setEditing(e => !e)} aria-pressed={editing}>
        {editing ? <><Icon name="check" size={14} />Done editing</> : <><Icon name="edit" size={14} />Edit</>}
      </button>
      {prevSoap && <button className="btn btn-ghost" onClick={() => setShowDiff(v => !v)} aria-pressed={showDiff}>
        {showDiff ? 'Hide changes' : 'Show changes'}
      </button>}
      {edited && <span className="text-xs text-zinc-400">Edited. Copy, PDF and re-analysis use your edits.</span>}
    </div>

    {prevSoap && showDiff && <p className="no-print text-sm text-zinc-400">
      {changed.length ? <>After your feedback, <span className="text-zinc-200">{changed.map(c => c.label).join(', ')}</span> changed. Added text is highlighted green, removed text is struck through.</> : 'Your feedback did not change the SOAP sections.'}
    </p>}

    <div ref={paperRef} className="report-wrap">
     <div className="clip" aria-hidden="true"><div className="clip-plate"><span className="clip-rivet" style={{ left: 26 }} /><span className="clip-rivet" style={{ right: 26 }} /></div><div className="clip-lever" /></div>
     <div className="sheet">
      <article className="report-paper px-6 pb-10 pt-12 sm:px-12" aria-label="Clinical assessment">
        <header className="flex items-end justify-between gap-4 border-b-2 border-gray-900 pb-3">
          <div className="flex items-center gap-2.5">
            <Logo size={26} />
            <div>
              <p className="text-[15px] font-semibold leading-tight text-gray-900">ClinicalPilot</p>
              <p className="text-[11px] text-gray-500">Clinical decision support service</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[17px] font-semibold leading-tight text-gray-900">Clinical Assessment</p>
            <p className="text-[11px] text-gray-500">SOAP note</p>
          </div>
        </header>

        <dl className="doc-meta mt-5 grid-cols-2 sm:grid-cols-4">
          <Meta label="Date and time issued" value={completedAt ? fmtDateTime(completedAt) : 'Not recorded'} />
          <Meta label="Case reference" value={res?.request_id ? res.request_id.slice(0, 12).toUpperCase() : 'Local'} mono />
          <Meta label="Confidence" value={conf[0].toUpperCase() + conf.slice(1)} />
          <Meta label="Agent consensus" value={debate.final_consensus == null ? 'Single pass' : debate.final_consensus ? 'Reached' : 'Not reached'} />
        </dl>

        {SECTIONS.map((s, i) => {
          const didChange = changed.some(c => c.key === s.key);
          return <DocSection key={s.key} n={i + 1} title={s.label} note={diffOn && didChange ? 'Revised' : null}>
            <div className="doc-body">
              {editing ? <AutoTextarea label={s.label} value={asText(soap[s.key])} onChange={v => updateSoap({ [s.key]: v })} />
                : diffOn && didChange ? <Diff before={prevSoap[s.key]} after={soap[s.key]} />
                  : soap[s.key] ? <Markdown text={soap[s.key]} /> : <span className="text-gray-400">Not documented.</span>}
            </div>
            {s.key === 'assessment' && soap.uncertainty_reasoning && !editing && <p className="doc-body mt-2 text-[13.5px] text-gray-600"><span className="font-medium text-gray-800">Confidence rationale. </span>{soap.uncertainty_reasoning}</p>}
          </DocSection>;
        })}

        {soap.differentials?.length > 0 && <DocSection n={next()} title="Differential diagnosis">
          <div className="overflow-x-auto"><table className="doc-table">
            <thead><tr><th className="w-8">No.</th><th>Diagnosis</th><th className="w-28">Likelihood</th><th>Basis</th></tr></thead>
            <tbody>{soap.differentials.map((d, i) => <tr key={i}>
              <td className="font-mono text-xs text-gray-500">{i + 1}</td>
              <td className="font-medium text-gray-900">{d.diagnosis || d.name}</td>
              <td className="capitalize">{String(d.likelihood || d.confidence || '')}</td>
              <td className="text-[13px] text-gray-600">{d.reasoning}</td>
            </tr>)}</tbody>
          </table></div>
        </DocSection>}

        {soap.risk_scores && Object.keys(soap.risk_scores).length > 0 && <DocSection n={next()} title="Risk stratification">
          <table className="doc-table"><tbody>{Object.entries(soap.risk_scores).map(([k, v]) =>
            <tr key={k}><td className="w-1/2 text-gray-700">{k}</td><td className="font-medium text-gray-900">{asText(v)}</td></tr>)}</tbody></table>
        </DocSection>}

        {alertCount > 0 && <DocSection n={next()} title="Medication safety">
          <div className="overflow-x-auto"><table className="doc-table">
            <thead><tr><th>Item</th><th className="w-28">Severity</th><th>Finding and recommendation</th></tr></thead>
            <tbody>
              {[...ints.map(x => [x.drug_a && x.drug_b ? `${x.drug_a} + ${x.drug_b}` : 'Drug interaction', x.severity, x.description, x.recommendation]),
                ...contras.map(x => [[x.drug, x.disease].filter(Boolean).join(' in ') || 'Contraindication', x.severity, x.description, x.recommendation]),
                ...dosing.map(x => [x.drug || 'Dosing', x.alert_type, x.description || x.message, x.recommendation]),
                ...pops.map(x => [x.drug || 'Population', x.population, x.description, x.recommendation]),
              ].map(([item, sev, body, rec], i) => <tr key={i}>
                <td className="font-medium text-gray-900">{item}</td>
                <td className={`capitalize ${/contra|major|severe|high/i.test(sev || '') ? 'font-semibold text-red-800' : ''}`}>{sev || ''}</td>
                <td className="text-[13px]">{body}{rec && <span className="mt-0.5 block text-gray-600">Recommendation: {rec}</span>}</td>
              </tr>)}
            </tbody>
          </table></div>
        </DocSection>}

        {soap.citations?.length > 0 && <DocSection n={next()} title="References">
          <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-gray-700">
            {soap.citations.map((c, i) => <li key={i}><Markdown text={asText(c)} /></li>)}
          </ol>
        </DocSection>}

        {(soap.debate_summary || debate.summary || dissent.length > 0) && <DocSection n={next()} title="Review process">
          <Markdown text={soap.debate_summary || debate.summary} className="doc-body text-[13.5px] text-gray-700" />
          {dissent.length > 0 && <div className="mt-2 text-[13.5px] text-gray-700"><span className="font-medium text-gray-900">Unresolved points: </span>{dissent.map(asText).join('; ')}</div>}
        </DocSection>}

        <DocSection n={next()} title="Clinician review">
          {res.feedbackAt || edited
            ? <table className="doc-table"><tbody>
              {res.feedbackAt && <tr><td className="text-gray-900">Re-analysed with clinician feedback</td><td className="w-56 text-right tabular-nums">{fmtDateTime(res.feedbackAt)}</td></tr>}
              {edited && <tr><td className="text-gray-900">Edited by clinician</td><td className="w-56 text-right tabular-nums">{fmtDateTime(edited)}</td></tr>}
            </tbody></table>
            : <p className="doc-body text-[13.5px]"><span className="font-semibold text-gray-900">Not reviewed.</span> This note was generated automatically and has not been edited or checked by a clinician.</p>}
        </DocSection>

        <footer className="mt-8 flex flex-wrap justify-between gap-x-6 gap-y-1 border-t border-gray-300 pt-2.5 text-[11px] text-gray-500">
          <span>Generated by ClinicalPilot{completedAt ? ` on ${fmtDateTime(completedAt)}` : ''}{soap.model_used ? ` · ${soap.model_used}` : ''}{debate.round_number > 0 ? ` · ${debate.round_number} review round${debate.round_number > 1 ? 's' : ''}` : ''}</span>
          <span>For research and education only. Requires clinician review.</span>
        </footer>
      </article>
     </div>
    </div>

    <section className="card no-print" aria-labelledby="fb-h">
      <CardHead id="fb-h" icon="userCheck" tone="violet" title="Doctor feedback" subtitle="Your corrections go through a full new review" />
      <div className="p-5">
        <label htmlFor="fb-text" className="sr-only">Feedback</label>
        <textarea id="fb-text" value={fb} onChange={e => setFb(e.target.value)} rows={3} disabled={refining}
          placeholder="Corrections, missing context, or findings you disagree with"
          className="field resize-y"
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submitFeedback(); } }} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <MicBtn onTranscript={t => setFb(p => (p ? p + ' ' : '') + t)} />
          <span className="text-xs text-zinc-500">{refining ? 'Re-analysis is running. Progress is shown above and continues if you switch pages.' : 'Changed sections are highlighted when it finishes.'}</span>
          <button className="btn ml-auto bg-violet-600 font-semibold text-white hover:bg-violet-500" onClick={submitFeedback} disabled={busy || !fb.trim()}>
            {refining ? <><Spinner />Re-analyzing</> : <><Icon name="refresh" size={14} />Re-analyze</>}
          </button>
        </div>
      </div>
    </section>
  </div>;
}

const ALERT_TONE = {
  rose: 'border-rose-200 bg-rose-50 text-rose-900', orange: 'border-orange-200 bg-orange-50 text-orange-900',
  amber: 'border-amber-200 bg-amber-50 text-amber-900', blue: 'border-blue-200 bg-blue-50 text-blue-900',
};
function Alert({ tone, title, tag, body, rec }) {
  return <div className={`rounded-md border px-3 py-2.5 ${ALERT_TONE[tone]}`}>
    <div className="flex items-baseline justify-between gap-3">
      <span className="font-semibold">{title}</span>
      {tag && <span className="text-xs font-medium capitalize opacity-80">{tag}</span>}
    </div>
    {body && <p className="mt-1 opacity-90">{body}</p>}
    {rec && <p className="mt-1 text-emerald-800">Recommendation: {rec}</p>}
  </div>;
}
