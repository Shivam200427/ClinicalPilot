// Small shared UI pieces: icons, logo, toasts, markdown, switches, dialogs.
const { useState, useEffect, useRef, useCallback, createContext, useContext, useId } = React;

/* ── Icons (Lucide paths, inline so there is no icon dependency) ── */
const P = {
  mic: <><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" /></>,
  play: <polygon points="6 3 20 12 6 21 6 3" />,
  square: <rect width="12" height="12" x="6" y="6" rx="2" />,
  copy: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  edit: <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />,
  check: <polyline points="20 6 9 17 4 12" />,
  x: <><line x1="18" x2="6" y1="6" y2="18" /><line x1="6" x2="18" y1="6" y2="18" /></>,
  alert: <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" x2="12" y1="9" y2="13" /><line x1="12" x2="12.01" y1="17" y2="17" /></>,
  upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" x2="12" y1="3" y2="15" /></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></>,
  printer: <><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect width="12" height="8" x="6" y="14" /></>,
  refresh: <><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></>,
  ext: <><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>,
  trash: <><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
  send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
  menu: <><line x1="4" x2="20" y1="12" y2="12" /><line x1="4" x2="20" y1="6" y2="6" /><line x1="4" x2="20" y1="18" y2="18" /></>,
  chevRight: <polyline points="9 18 15 12 9 6" />,
  chevDown: <polyline points="6 9 12 15 18 9" />,
  settings: <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>,
  file: <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></>,
  history: <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></>,
  circle: <circle cx="12" cy="12" r="9" />,
  stethoscope: <><path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" /><path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4" /><circle cx="20" cy="10" r="2" /></>,
  zap: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10" />,
  microscope: <><path d="M6 18h8" /><path d="M3 22h18" /><path d="M14 22a7 7 0 1 0 0-14h-1" /><path d="M9 14h2" /><path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z" /><path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3" /></>,
  workflow: <><rect width="8" height="8" x="3" y="3" rx="2" /><path d="M7 11v4a2 2 0 0 0 2 2h4" /><rect width="8" height="8" x="13" y="13" rx="2" /></>,
  wrench: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />,
  message: <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" />,
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  book: <><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></>,
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" /><path d="M12 8v4" /><path d="M12 16h.01" /></>,
  scale: <><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" /><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" /><path d="M7 21h10" /><path d="M12 3v18" /><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" /></>,
  pill: <><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" /><path d="m8.5 8.5 7 7" /></>,
  sparkles: <><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /></>,
  cpu: <><rect width="16" height="16" x="4" y="4" rx="2" /><rect width="6" height="6" x="9" y="9" rx="1" /><path d="M15 2v2" /><path d="M15 20v2" /><path d="M2 15h2" /><path d="M2 9h2" /><path d="M20 15h2" /><path d="M20 9h2" /><path d="M9 2v2" /><path d="M9 20v2" /></>,
  userCheck: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><polyline points="16 11 18 13 22 9" /></>,
  calculator: <><rect width="16" height="20" x="4" y="2" rx="2" /><line x1="8" x2="16" y1="6" y2="6" /><line x1="16" x2="16" y1="14" y2="18" /><path d="M16 10h.01" /><path d="M12 10h.01" /><path d="M8 10h.01" /><path d="M12 14h.01" /><path d="M8 14h.01" /><path d="M12 18h.01" /><path d="M8 18h.01" /></>,
  terminal: <><polyline points="4 17 10 11 4 5" /><line x1="12" x2="20" y1="19" y2="19" /></>,
  key: <><path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z" /><circle cx="16.5" cy="7.5" r=".5" fill="currentColor" /></>,
  heart: <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />,
  eye: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>,
  layers: <><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></>,
  minus: <line x1="5" x2="19" y1="12" y2="12" />,
};

export function Icon({ name, size = 16, className = '', strokeWidth = 2 }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
    className={`shrink-0 ${className}`} aria-hidden="true" focusable="false">{P[name]}</svg>;
}

/* Brand mark: a flat pulse line in a solid blue square. */
export function Logo({ size = 24 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block' }}>
    <rect width="24" height="24" rx="5" fill="#2563eb" />
    <path d="M4 13h3.5l2-5 3 9 2-6 1.2 2H20" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/* Tinted icon tile used in card and page headers. */
export const TONES = {
  blue: 'bg-brand-500/10 border-brand-500/20 text-brand-400',
  sky: 'bg-sky-500/10 border-sky-500/20 text-sky-400',
  rose: 'bg-rose-500/10 border-rose-500/20 text-rose-400',
  amber: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
  violet: 'bg-violet-500/10 border-violet-500/20 text-violet-400',
  emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
  teal: 'bg-teal-500/10 border-teal-500/20 text-teal-400',
  zinc: 'bg-zinc-800 border-zinc-700 text-zinc-400',
};
export function IconTile({ icon, tone = 'blue', size = 36 }) {
  return <span className={`tile ${TONES[tone]}`} style={{ width: size, height: size }} aria-hidden="true">
    <Icon name={icon} size={Math.round(size * 0.5)} />
  </span>;
}

/* Card header with an icon tile, title and optional subtitle/actions. */
export function CardHead({ icon, tone, title, subtitle, id, children }) {
  return <div className="card-head">
    <div className="flex min-w-0 items-center gap-3">
      {icon && <Icon name={icon} size={16} className="text-zinc-400" />}
      <div className="min-w-0">
        <h2 id={id} className="card-title">{title}</h2>
        {subtitle && <p className="truncate text-xs text-zinc-400">{subtitle}</p>}
      </div>
    </div>
    {children}
  </div>;
}

export const Spinner = ({ dark = false, className = '' }) =>
  <span className={`spinner ${dark ? 'spinner-dark' : ''} ${className}`} role="presentation" />;

/* ── Toasts (announced to screen readers) ── */
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const add = useCallback((msg, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setItems(p => [...p.slice(-3), { id, msg, type }]);
    setTimeout(() => setItems(p => p.filter(x => x.id !== id)), type === 'error' ? 7000 : 4000);
  }, []);
  const tone = {
    error: 'border-rose-500/40 bg-rose-950/80 text-rose-200', success: 'border-emerald-500/40 bg-emerald-950/80 text-emerald-200',
    warning: 'border-amber-500/40 bg-amber-950/80 text-amber-200', info: 'border-brand-500/40 bg-slate-900/90 text-brand-200',
  };
  return <ToastCtx.Provider value={add}>
    {children}
    <div className="fixed bottom-4 right-4 z-[300] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2" role="status" aria-live="polite">
      {items.map(t => <div key={t.id} className={`anim-fade-up flex items-start gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg backdrop-blur-md ${tone[t.type] || tone.info}`}>
        <span className="flex-1">{t.msg}</span>
        <button className="text-zinc-500 hover:text-zinc-200" aria-label="Dismiss" onClick={() => setItems(p => p.filter(x => x.id !== t.id))}><Icon name="x" size={14} /></button>
      </div>)}
    </div>
  </ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);

/* ── Voice dictation ── */
export function MicBtn({ onTranscript, className = '' }) {
  const [on, setOn] = useState(false);
  const ref = useRef(null);
  const cb = useRef(onTranscript);
  cb.current = onTranscript;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  useEffect(() => () => ref.current?.stop(), []);
  if (!SR) return null;
  const toggle = () => {
    if (on) { ref.current?.stop(); setOn(false); return; }
    const r = new SR();
    r.continuous = true; r.interimResults = false; r.lang = 'en-US';
    r.onresult = e => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) cb.current(e.results[i][0].transcript.trim()); };
    r.onerror = () => setOn(false);
    r.onend = () => setOn(false);
    r.start(); ref.current = r; setOn(true);
  };
  return <button type="button" onClick={toggle} aria-pressed={on} aria-label={on ? 'Stop dictation' : 'Dictate'}
    title={on ? 'Stop dictation' : 'Dictate'} className={`btn btn-secondary px-2.5 ${on ? 'mic-active' : ''} ${className}`}>
    <Icon name="mic" size={16} />{on && <span className="text-xs">Listening</span>}
  </button>;
}

/* ── Markdown: the small subset models actually produce. Builds React nodes, so no HTML injection. ── */
const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)<]+|PMID:?\s*\d{5,9}|\*[^*\s\n][^*\n]*\*)/g;

function inline(text, keyBase) {
  const out = [];
  let last = 0, m, k = 0;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0], key = `${keyBase}-${k++}`;
    if (t.startsWith('**') || t.startsWith('__')) out.push(<strong key={key}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={key}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('[')) { const i = t.indexOf(']('); out.push(<a key={key} href={t.slice(i + 2, -1)} target="_blank" rel="noopener noreferrer">{t.slice(1, i)}</a>); }
    else if (t.startsWith('http')) out.push(<a key={key} href={t} target="_blank" rel="noopener noreferrer">{t}</a>);
    else if (t.startsWith('PMID')) { const id = t.match(/\d+/)[0]; out.push(<a key={key} href={`https://pubmed.ncbi.nlm.nih.gov/${id}/`} target="_blank" rel="noopener noreferrer">{t}</a>); }
    else out.push(<em key={key}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function asText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(x => `- ${asText(x)}`).join('\n');
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `**${k}:** ${asText(x)}`).join('\n');
  return String(v);
}

export function Markdown({ text, className = '' }) {
  const src = asText(text).replace(/\r\n/g, '\n').trim();
  if (!src) return null;
  const lines = src.split('\n');
  const blocks = [];
  let para = [], list = null;
  const flushPara = () => { if (para.length) { blocks.push({ t: 'p', lines: para }); para = []; } };
  const flushList = () => { if (list) { blocks.push(list); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const ul = line.match(/^\s*[-*•]\s+(.*)$/), ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/), h = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (h) { flushPara(); flushList(); blocks.push({ t: 'h', text: h[1] }); continue; }
    if (ul || ol) {
      flushPara();
      const type = ul ? 'ul' : 'ol';
      if (!list || list.t !== type) { flushList(); list = { t: type, items: [], start: ol ? +ol[1] : 1 }; }
      list.items.push(ul ? ul[1] : ol[2]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue; }
    flushList(); para.push(line);
  }
  flushPara(); flushList();
  return <div className={`md ${className}`}>{blocks.map((b, i) => {
    if (b.t === 'h') return <h4 key={i}>{inline(b.text, i)}</h4>;
    if (b.t === 'ul') return <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it, `${i}-${j}`)}</li>)}</ul>;
    if (b.t === 'ol') return <ol key={i} start={b.start}>{b.items.map((it, j) => <li key={j}>{inline(it, `${i}-${j}`)}</li>)}</ol>;
    return <p key={i}>{b.lines.map((l, j) => <React.Fragment key={j}>{j > 0 && <br />}{inline(l, `${i}-${j}`)}</React.Fragment>)}</p>;
  })}</div>;
}

/* ── Switch ── */
export function Switch({ checked, onChange, label, description, disabled }) {
  const id = useId();
  return <div className="flex items-start justify-between gap-4">
    <div className="min-w-0">
      <label htmlFor={id} className="text-sm font-medium text-zinc-100">{label}</label>
      {description && <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">{description}</p>}
    </div>
    <button id={id} type="button" role="switch" aria-checked={!!checked} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${checked ? 'border-brand-500 bg-brand-600' : 'border-zinc-600 bg-zinc-800'}`}>
      <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-[left] ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  </div>;
}

/* ── Tabs (pill style, as in the original UI) ── */
export function Tabs({ tabs, value, onChange, className = '' }) {
  return <div role="tablist" className={`flex flex-wrap gap-1 ${className}`}>
    {tabs.map(([id, label, icon]) => <button key={id} role="tab" aria-selected={value === id} onClick={() => onChange(id)} className="tab-pill flex items-center gap-1.5">
      {icon && <Icon name={icon} size={14} />}{label}</button>)}
  </div>;
}

/* ── Dialog: focus trap-lite, Escape to close, labelled ── */
export function Dialog({ title, description, onClose, children, footer }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current?.querySelector('input,textarea,select,button');
    el?.focus();
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className="anim-fade-up w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div>
          <h2 id={titleId} className="font-display text-lg font-bold text-white">{title}</h2>
          {description && <div className="mt-1 text-sm text-zinc-400">{description}</div>}
        </div>
        <button onClick={onClose} className="btn btn-ghost -mr-2 -mt-1 p-1.5" aria-label="Close"><Icon name="x" /></button>
      </div>
      <div className="px-5 py-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">{footer}</div>}
    </div>
  </div>;
}

/* ── Page header ── */
export function PageHeader({ icon, tone = 'blue', title, subtitle, actions }) {
  return <div className="anim-fade-up mb-6 flex flex-wrap items-center justify-between gap-3">
    <div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-zinc-400">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>;
}

/* Elapsed-time ticker (re-renders once a second while running). */
export function useNow(active, interval = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(iv);
  }, [active, interval]);
  return now;
}
