// Tureng provider: fetches the dictionary page through the CORS proxy and parses it.
// DOMParser documents are inert: no scripts run and no images/ads are loaded.
import { LANGS } from './config.js';

const LANG_BY_NAME = Object.fromEntries(Object.entries(LANGS).map(([code, l]) => [l.name.toLowerCase(), code]));
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

async function fetchViaProxy(proxyUrl, params, signal) {
  const base = new URL(proxyUrl, location.href);
  Object.entries(params).forEach(([k, v]) => base.searchParams.set(k, v));
  const res = await fetch(base, { signal, headers: { Accept: 'text/html' } });
  if (!res.ok) throw new Error(`proxy_http_${res.status}`);
  return res.text();
}

export async function turengLookup(term, pair, proxyUrl, signal) {
  const html = await fetchViaProxy(proxyUrl, { pair, q: term }, signal);
  const result = parseTurengHtml(html, pair);
  if (!result.sections.length && !result.suggestions.length && !result.notFound) {
    throw new Error('parse_failed');
  }
  return result;
}

/** Tureng's "More Sentences" page (EN⇄TR only). */
export async function turengSentences(term, pair, proxyUrl, signal) {
  const html = await fetchViaProxy(proxyUrl, { pair, q: term, kind: 'sentences' }, signal);
  return parseSentencesHtml(html);
}

// Sentence text as [text, highlighted] parts; Tureng wraps the matched word in <span>.
function sentenceParts(nodes) {
  const parts = [];
  for (const n of nodes) {
    const t = n.textContent.replace(/\s+/g, ' ');
    if (!t.trim() && !parts.length) continue;
    const bold = n.nodeType === 1 && n.tagName === 'SPAN';
    const last = parts[parts.length - 1];
    if (last && last[1] === bold) last[0] += t;
    else parts.push([t, bold]);
  }
  if (parts.length) {
    parts[0][0] = parts[0][0].trimStart();
    parts[parts.length - 1][0] = parts[parts.length - 1][0].trimEnd();
  }
  return parts.filter((p) => p[0]);
}

// Inline example under a result row: "<src sentence><br><dst sentence><br><br><a>More Sentences</a>".
function parseExampleCell(td) {
  const lines = [[]];
  for (const n of td.childNodes) {
    if (n.nodeType === 1 && n.tagName === 'BR') lines.push([]);
    else if (n.nodeType === 1 && n.tagName === 'A') continue;
    else lines[lines.length - 1].push(n);
  }
  const [src, dst] = lines.map(sentenceParts).filter((p) => p.length);
  return src ? { src, dst: dst || [] } : null;
}

export function parseSentencesHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table.sentencesSearchResultsTable');
  if (!table) return { groups: [], count: 0 };
  const headers = [...table.rows[0].cells].map(text);
  const langs = [headerLang(headers[1]) || 'en', headerLang(headers[2]) || 'tr'];
  const groups = [];
  let count = 0;
  for (const tr of table.rows) {
    const list = tr.querySelector('.sentencesPerTermList');
    if (list) {
      const g = groups[groups.length - 1] || groups[groups.push({ src: '', dst: '', type: '', pairs: [] }) - 1];
      for (const pairEl of list.querySelectorAll('.sentencePair')) {
        const [a, b] = [...pairEl.querySelectorAll('li')].map((li) => sentenceParts(li.childNodes));
        if (a?.length) { g.pairs.push({ src: a, dst: b || [] }); count++; }
      }
    } else if (tr.cells.length >= 4 && tr.cells[0].tagName === 'TD') {
      groups.push({ src: text(tr.cells[1]), dst: text(tr.cells[2]), type: text(tr.cells[3]), pairs: [] });
    }
  }
  return { langs, groups: groups.filter((g) => g.pairs.length), count };
}

const headerLang = (header) => LANG_BY_NAME[(header || '').toLowerCase()] || '';

// Header text is authoritative: Tureng reuses the "tr" cell class for every non-English language.
function cellLang(td, header) {
  const fromHeader = headerLang(header);
  if (fromHeader) return fromHeader;
  for (const c of td.classList) if (LANGS[c]) return c;
  return '';
}

function cellTerm(td, lang) {
  const a = td.querySelector('a');
  const i = td.querySelector('i');
  return { text: a ? text(a) : text(td).replace(text(i), '').trim(), type: text(i), lang };
}

function shortTitle(raw) {
  if (/other terms/i.test(raw)) return 'In other phrases';
  if (/^meanings of/i.test(raw) || !raw) return 'Meanings';
  return raw.replace(/\s*:\s*\d+\s*result\(s\)\s*$/i, '');
}

export function parseTurengHtml(html, pair) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector('.tureng-searchresults-col-left') || doc.body;
  root.querySelectorAll('.tng-ad, script, style, iframe, ins, noscript, #historyArea').forEach((e) => e.remove());

  const h1 = text(root.querySelector('h1'));

  const audio = [...root.querySelectorAll('audio')]
    .map((a) => {
      const src = a.querySelector('source')?.getAttribute('src') || a.getAttribute('src');
      if (!src) return null;
      const locale = (src.match(/\/files\/([a-z]{2}-[A-Z]{2})\//) || [])[1] || '';
      return { src: src.startsWith('//') ? 'https:' + src : src, locale };
    })
    .filter(Boolean);

  const info = [...root.querySelectorAll('.term-description-box dl > div')]
    .map((div) => {
      const dd = div.querySelector('dd');
      const label = text(div.querySelector('dt')).replace(/:\s*$/, '');
      const links = dd ? [...dd.querySelectorAll('a')].map(text).filter(Boolean) : [];
      return { kind: [...div.classList].find((c) => c.startsWith('td-')) || '', label, value: text(dd), links };
    })
    .filter((x) => x.label && x.value);

  const sections = [];
  let hasMoreSentences = false;
  root.querySelectorAll('table.searchResultsTable').forEach((table) => {
    let h2 = table.previousElementSibling;
    while (h2 && h2.tagName !== 'H2' && h2.tagName !== 'TABLE') h2 = h2.previousElementSibling;
    const rawTitle = h2 && h2.tagName === 'H2' ? text(h2) : '';
    const headers = table.rows[0] ? [...table.rows[0].cells].map(text) : [];

    const groups = [];
    let count = 0;
    let lastItem = null;
    for (const tr of table.rows) {
      if (tr.classList.contains('mobile-category-row')) continue;
      if (tr.classList.contains('example-sentences-row')) {
        const td = tr.querySelector('td.example-sentences');
        const ex = td && parseExampleCell(td);
        if (ex && lastItem) lastItem.example = ex;
        if (td?.querySelector('.sentencesPerTermList-showMoreButton')) hasMoreSentences = true;
        continue;
      }
      const cells = tr.cells;
      if (cells.length < 4 || cells[0].tagName === 'TH') continue;
      const category = text(cells[1]);
      const src = cellTerm(cells[2], cellLang(cells[2], headers[2]));
      const dst = cellTerm(cells[3], cellLang(cells[3], headers[3]));
      if (!src.text && !dst.text) continue;
      let g = groups[groups.length - 1];
      if (!g || g.category !== category) groups.push((g = { category, items: [] }));
      lastItem = { src, dst };
      g.items.push(lastItem);
      count++;
    }
    if (count) {
      sections.push({
        title: shortTitle(rawTitle),
        rawTitle,
        langs: [headerLang(headers[2]), headerLang(headers[3])],
        groups,
        count,
      });
    }
  });

  const suggestions = [...root.querySelectorAll('.suggestion-list a')].map(text).filter(Boolean);
  const notFound = !sections.length && /not found|no result|bulunamadı|maybe the correct/i.test(h1);

  return { source: 'tureng', pair, term: notFound ? '' : h1, audio, info, sections, suggestions, notFound, hasMoreSentences };
}
