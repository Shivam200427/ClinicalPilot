// Shared helpers: API access, local persistence, formatting, lazy script loading.

export const API = window.location.origin;

// Set by App so any request can open the "enter this key" dialog.
let promptKey = null;
export function setKeyPrompt(fn) { promptKey = fn; }
export function openKeyPrompt(keyRef, profile, reason) { if (promptKey) promptKey(keyRef, profile, reason); }

// fetch wrapper: a 428 {needs_key} response opens the key dialog and throws a readable error.
export async function cpFetch(url, opts) {
  const r = await fetch(url, opts);
  if (r.status === 428) {
    const j = await r.json().catch(() => ({}));
    if (j && j.needs_key) openKeyPrompt(j.key_ref, j.profile, j.reason);
    throw new Error((j && j.detail) || 'An API key is required. Add it in Settings.');
  }
  return r;
}

// JSON helper that turns HTTP errors into thrown Errors with the server's message.
export async function api(path, { method = 'GET', body, signal } = {}) {
  const opts = { method, signal };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const r = await cpFetch(`${API}${path}`, opts);
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    const d = e.detail;
    throw new Error(typeof d === 'string' ? d : `Request failed (HTTP ${r.status})`);
  }
  return r.json();
}

// ── localStorage, never throws (private mode, quota, blocked storage) ──
const PREFIX = 'cp.';
export const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(PREFIX + key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; }
    catch { return false; }
  },
  remove(key) { try { localStorage.removeItem(PREFIX + key); } catch {} },
};

// Persist a piece of state, debounced so streaming updates don't hammer storage.
export function usePersisted(key, initial, delay = 400) {
  const { useState, useEffect, useRef } = React;
  const [value, setValue] = useState(() => store.get(key, typeof initial === 'function' ? initial() : initial));
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => store.set(key, value), delay);
    return () => clearTimeout(timer.current);
  }, [key, value, delay]);
  return [value, setValue];
}

// ── Formatting ──
export function fmtDuration(sec) {
  if (sec == null || !isFinite(sec) || sec < 0) return '';
  if (sec < 10) return `${sec.toFixed(1)}s`;
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
export function fmtClock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
export function fmtDateTime(ts) {
  return new Date(ts).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function fmtDate(ts) {
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// MedGemma 1.5 streams "<unused94>thought ... <unused95>answer". Label the two parts
// instead of showing raw control tokens. (The server strips the thinking from final output.)
export function cleanModelText(t) {
  return (t || '')
    .replace(/<unused94>\s*thought\s*/g, 'Thinking:\n')
    .replace(/<unused95>\s*/g, '\n\nAnswer:\n')
    .replace(/<unused\d+>/g, '');
}

// Load a CDN script once (Mermaid, html2pdf are only needed on some pages).
const loading = {};
export function loadScript(src) {
  if (!loading[src]) {
    loading[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = () => { delete loading[src]; reject(new Error(`Could not load ${src}`)); };
      document.head.appendChild(s);
    });
  }
  return loading[src];
}
export const CDN = {
  mermaid: 'https://cdn.jsdelivr.net/npm/mermaid@10.9.3/dist/mermaid.min.js',
  html2pdf: 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
};

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    // Clipboard API needs a secure context; fall back to a hidden textarea.
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }
}

// ── Word diff (LCS) for "what changed after doctor feedback" ──
// Returns [{type:'same'|'ins'|'del', text}]. Sections are short, so O(n·m) is fine.
export function wordDiff(before, after) {
  const a = (before || '').split(/(\s+)/), b = (after || '').split(/(\s+)/);
  if (a.length * b.length > 400000) return [{ type: 'del', text: before }, { type: 'ins', text: after }];
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  const push = (type, text) => { const last = out[out.length - 1]; if (last && last.type === type) last.text += text; else out.push({ type, text }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push('same', a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', a[i++]);
    else push('ins', b[j++]);
  }
  while (i < n) push('del', a[i++]);
  while (j < m) push('ins', b[j++]);
  return out;
}

export function soapToText(s) {
  if (!s) return '';
  const lines = ['SOAP note (ClinicalPilot)', ''];
  for (const [k, label] of [['subjective', 'Subjective'], ['objective', 'Objective'], ['assessment', 'Assessment'], ['plan', 'Plan']]) {
    lines.push(`${label}:`, s[k] || 'Not documented', '');
  }
  if (s.differentials?.length) {
    lines.push('Differentials:');
    s.differentials.forEach((d, i) => lines.push(`${i + 1}. ${d.diagnosis || d.name}${d.likelihood || d.confidence ? ` (${d.likelihood || d.confidence})` : ''}`));
    lines.push('');
  }
  if (s.uncertainty) lines.push(`Confidence: ${s.uncertainty}`);
  return lines.join('\n');
}
