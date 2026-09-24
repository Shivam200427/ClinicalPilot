import { api, usePersisted } from '../lib.js';
import { Icon, Spinner, MicBtn, PageHeader, CardHead, Tabs, useToast } from '../ui.jsx';

const { useState, useId } = React;

function Num({ label, unit, value, onChange, placeholder }) {
  const id = useId();
  return <div>
    <label htmlFor={id} className="label">{label}{unit && <span className="text-zinc-500"> ({unit})</span>}</label>
    <input id={id} type="number" inputMode="decimal" className="field" value={value ?? ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
  </div>;
}

function Result({ children, tone = 'default' }) {
  const cls = tone === 'warn' ? 'border-amber-500/30 text-amber-100' : 'border-zinc-700 text-zinc-100';
  return <div className={`anim-fade-up mt-4 rounded-xl border px-3.5 py-3 text-sm ${tone === 'warn' ? 'bg-amber-500/[.06]' : 'border-brand-500/20 bg-brand-500/10 text-brand-100'} ${cls}`} aria-live="polite">{children}</div>;
}

const CALCS = [['bmi', 'BMI'], ['map', 'MAP'], ['crcl', 'CrCl'], ['ag', 'Anion gap'], ['qtc', 'QTc']];

function Calculators() {
  const [tab, setTab] = usePersisted('tools.calc', 'bmi');
  const [v, setV] = usePersisted('tools.values', {});
  const set = k => x => setV(p => ({ ...p, [k]: x }));
  const n = k => parseFloat(v[k]);
  const ok = (...ks) => ks.every(k => isFinite(n(k)) && n(k) > 0);

  let out = null;
  if (tab === 'bmi' && ok('w', 'h')) {
    const b = n('w') / (n('h') / 100) ** 2;
    const c = b < 18.5 ? 'Underweight' : b < 25 ? 'Normal' : b < 30 ? 'Overweight' : 'Obese';
    out = <Result tone={b < 18.5 || b >= 30 ? 'warn' : 'default'}>BMI <strong>{b.toFixed(1)}</strong> kg/m², {c.toLowerCase()}</Result>;
  }
  if (tab === 'map' && ok('sbp', 'dbp')) {
    const m = (n('sbp') + 2 * n('dbp')) / 3;
    out = <Result tone={m < 65 || m > 110 ? 'warn' : 'default'}>MAP <strong>{m.toFixed(0)}</strong> mmHg{m < 65 ? ', below the usual 65 mmHg perfusion target' : ''}</Result>;
  }
  if (tab === 'crcl' && ok('age', 'wt', 'cr')) {
    const c = ((140 - n('age')) * n('wt')) / (72 * n('cr')) * (v.sex === 'f' ? 0.85 : 1);
    out = <Result tone={c < 30 ? 'warn' : 'default'}>CrCl <strong>{c.toFixed(0)}</strong> mL/min (Cockcroft-Gault, actual body weight){c < 30 ? '. Many renally cleared drugs need adjustment.' : ''}</Result>;
  }
  if (tab === 'ag' && ok('na', 'cl', 'hco3')) {
    const g = n('na') - (n('cl') + n('hco3'));
    const alb = n('alb');
    const corr = isFinite(alb) && alb > 0 ? g + 2.5 * (4 - alb) : null;
    out = <Result tone={(corr ?? g) > 12 ? 'warn' : 'default'}>Anion gap <strong>{g.toFixed(1)}</strong> mEq/L
      {corr != null && <>, albumin-corrected <strong>{corr.toFixed(1)}</strong></>}. Reference about 8 to 12.</Result>;
  }
  if (tab === 'qtc' && ok('qt', 'hr')) {
    const rr = 60 / n('hr');
    const q = n('qt') / Math.sqrt(rr);
    const lim = v.sex === 'f' ? 470 : 450;
    out = <Result tone={q > lim ? 'warn' : 'default'}>QTc <strong>{q.toFixed(0)}</strong> ms (Bazett){q > lim ? `, prolonged (over ${lim} ms)` : ''}{q > 500 ? '. Above 500 ms carries high torsades risk.' : ''}</Result>;
  }

  const sexPicker = <div>
    <span className="label">Sex</span>
    <div className="flex gap-1" role="radiogroup" aria-label="Sex">
      {[['m', 'Male'], ['f', 'Female']].map(([k, l]) => <button key={k} role="radio" aria-checked={(v.sex || 'm') === k}
        className={`btn btn-sm flex-1 ${(v.sex || 'm') === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => set('sex')(k)}>{l}</button>)}
    </div>
  </div>;

  return <section className="card" aria-labelledby="calc-h">
    <CardHead id="calc-h" icon="calculator" tone="blue" title="Medical calculators" />
    <div className="p-5">
      <Tabs tabs={CALCS} value={tab} onChange={setTab} className="mb-4" />
      <div className="grid grid-cols-2 gap-3">
        {tab === 'bmi' && <><Num label="Weight" unit="kg" value={v.w} onChange={set('w')} placeholder="70" /><Num label="Height" unit="cm" value={v.h} onChange={set('h')} placeholder="175" /></>}
        {tab === 'map' && <><Num label="Systolic" unit="mmHg" value={v.sbp} onChange={set('sbp')} placeholder="120" /><Num label="Diastolic" unit="mmHg" value={v.dbp} onChange={set('dbp')} placeholder="80" /></>}
        {tab === 'crcl' && <><Num label="Age" unit="years" value={v.age} onChange={set('age')} placeholder="65" /><Num label="Weight" unit="kg" value={v.wt} onChange={set('wt')} placeholder="70" />
          <Num label="Serum creatinine" unit="mg/dL" value={v.cr} onChange={set('cr')} placeholder="1.1" />{sexPicker}</>}
        {tab === 'ag' && <><Num label="Sodium" unit="mEq/L" value={v.na} onChange={set('na')} placeholder="140" /><Num label="Chloride" unit="mEq/L" value={v.cl} onChange={set('cl')} placeholder="104" />
          <Num label="Bicarbonate" unit="mEq/L" value={v.hco3} onChange={set('hco3')} placeholder="24" /><Num label="Albumin (optional)" unit="g/dL" value={v.alb} onChange={set('alb')} placeholder="4.0" /></>}
        {tab === 'qtc' && <><Num label="QT interval" unit="ms" value={v.qt} onChange={set('qt')} placeholder="400" /><Num label="Heart rate" unit="bpm" value={v.hr} onChange={set('hr')} placeholder="75" />{sexPicker}</>}
      </div>
      {out}
    </div>
  </section>;
}

function DrugChecker() {
  const toast = useToast();
  const [drugs, setDrugs] = usePersisted('tools.drugs', '');
  const [res, setRes] = usePersisted('tools.drugres', null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    const list = drugs.split(',').map(s => s.trim()).filter(Boolean);
    if (list.length < 2) { toast('Enter at least two drugs, separated by commas', 'warning'); return; }
    setBusy(true); setRes(null);
    try { setRes(await api(`/api/safety-check?drugs=${encodeURIComponent(list.join(','))}`)); }
    catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };
  const rx = Array.isArray(res?.rxnorm_interactions) ? res.rxnorm_interactions : [];
  const mp = res?.med_panel || {};
  const alerts = [
    ...(mp.drug_interactions || []).map(x => ({ title: [x.drug_a, x.drug_b].filter(Boolean).join(' + ') || 'Interaction', sev: x.severity, body: x.description, rec: x.recommendation })),
    ...(mp.contraindications || []).map(x => ({ title: [x.drug, x.disease].filter(Boolean).join(' in ') || 'Contraindication', sev: x.severity, body: x.description, rec: x.recommendation })),
    ...(mp.dosing_alerts || []).map(x => ({ title: x.drug || 'Dosing', sev: x.alert_type, body: x.description, rec: x.recommendation })),
    ...(mp.population_flags || []).map(x => ({ title: x.drug || 'Population', sev: x.population, body: x.description, rec: x.recommendation })),
    ...rx.map(x => ({ title: (x.drugs || []).join(' + ') || 'RxNorm', sev: x.severity, body: x.description })),
  ];
  const names = typeof res?.drugbank === 'string' ? res.drugbank.split('\n').filter(Boolean) : [];

  return <section className="card" aria-labelledby="drug-h">
    <CardHead id="drug-h" icon="pill" tone="rose" title="Drug interaction checker" subtitle="Medication check engine plus DrugBank names" />
    <div className="p-5">
      <label htmlFor="drugs" className="label">Medications, comma separated</label>
      <div className="flex gap-2">
        <input id="drugs" className="field" value={drugs} onChange={e => setDrugs(e.target.value)} placeholder="warfarin, amiodarone, aspirin"
          onKeyDown={e => { if (e.key === 'Enter') check(); }} />
        <MicBtn onTranscript={t => setDrugs(p => (p ? p + ', ' : '') + t)} />
      </div>
      <button className="btn mt-3 w-full bg-rose-600 py-2.5 font-semibold text-white hover:bg-rose-500" onClick={check} disabled={busy}>{busy ? <><Spinner />Checking…</> : 'Check interactions'}</button>
      <p className="mt-2 text-xs text-zinc-500">Reviewed by the medication check engine. Takes a few seconds on a cloud model, longer on a local one.</p>

      {res && <div className="mt-4 space-y-2" aria-live="polite">
        {alerts.length === 0 && !res.med_panel_error && <p className="text-sm text-emerald-300">No interactions were flagged for this list.</p>}
        {res.med_panel_error && <p className="text-sm text-rose-300">Medication check failed: {res.med_panel_error}</p>}
        {alerts.map((a, i) => <div key={i} className="rounded-xl border border-rose-500/15 bg-rose-500/5 px-3.5 py-2.5 text-sm">
          <div className="flex items-baseline justify-between gap-3"><span className="font-medium text-zinc-100">{a.title}</span>{a.sev && <span className="text-xs capitalize text-amber-300">{a.sev}</span>}</div>
          {a.body && <p className="mt-1 text-zinc-300">{a.body}</p>}
          {a.rec && <p className="mt-1 text-emerald-300">{a.rec}</p>}
        </div>)}
        {mp.summary && <p className="text-sm text-zinc-400">{mp.summary}</p>}
        {names.length > 0 && <details className="text-xs text-zinc-400">
          <summary className="cursor-pointer text-zinc-300">Name check against DrugBank</summary>
          <ul className="mt-1 space-y-0.5 font-mono">{names.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </details>}
      </div>}
    </div>
  </section>;
}

const REFERENCE = [
  ['Adult vitals', [['Heart rate', '60 to 100 bpm'], ['Blood pressure', '90/60 to 120/80'], ['Resp. rate', '12 to 20 /min'], ['Temperature', '36.5 to 37.3 °C'], ['SpO₂', '95% or higher']]],
  ['Common labs', [['Troponin I', '< 0.04 ng/mL'], ['INR on warfarin', '2.0 to 3.0'], ['D-dimer', '< 0.5 µg/mL FEU'], ['Creatinine', '0.7 to 1.3 mg/dL'], ['WBC', '4.5 to 11.0 K/µL']]],
  ['ESI levels', [['1', 'Resuscitation'], ['2', 'Emergent'], ['3', 'Urgent'], ['4', 'Less urgent'], ['5', 'Non-urgent']]],
];

export function ToolsView() {
  return <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
    <PageHeader icon="wrench" tone="blue" title="Clinical tools" subtitle="Drug interactions, bedside calculators and reference ranges" />
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      <DrugChecker />
      <Calculators />
    </div>
    <section className="card mt-5" aria-labelledby="ref-h">
      <CardHead id="ref-h" icon="book" tone="emerald" title="Quick reference" subtitle="Typical adult values; local lab ranges take precedence" />
      <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-3">
        {REFERENCE.map(([title, rows]) => <div key={title} className="rounded-xl border border-zinc-800 bg-zinc-800/40 p-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">{title}</h3>
          <dl className="space-y-1 text-sm">{rows.map(([k, val]) => <div key={k} className="flex justify-between gap-3">
            <dt className="text-zinc-400">{k}</dt><dd className="text-right tabular-nums text-zinc-100">{val}</dd></div>)}</dl>
        </div>)}
      </div>
    </section>
  </div>;
}
