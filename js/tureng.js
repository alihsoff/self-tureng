// Tureng provider: fetches the dictionary page through the CORS proxy and parses it.
// DOMParser documents are inert: no scripts run and no images/ads are loaded.
import { LANGS } from './config.js';

const LANG_BY_NAME = Object.fromEntries(Object.entries(LANGS).map(([code, l]) => [l.name.toLowerCase(), code]));
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

export async function turengLookup(term, pair, proxyUrl, signal) {
  const base = new URL(proxyUrl, location.href);
  base.searchParams.set('pair', pair);
  base.searchParams.set('q', term);
  const res = await fetch(base, { signal, headers: { Accept: 'text/html' } });
  if (!res.ok) throw new Error(`proxy_http_${res.status}`);
  const html = await res.text();
  const result = parseTurengHtml(html, pair);
  if (!result.sections.length && !result.suggestions.length && !result.notFound) {
    throw new Error('parse_failed');
  }
  return result;
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
  root.querySelectorAll('table.searchResultsTable').forEach((table) => {
    let h2 = table.previousElementSibling;
    while (h2 && h2.tagName !== 'H2' && h2.tagName !== 'TABLE') h2 = h2.previousElementSibling;
    const rawTitle = h2 && h2.tagName === 'H2' ? text(h2) : '';
    const headers = table.rows[0] ? [...table.rows[0].cells].map(text) : [];

    const groups = [];
    let count = 0;
    for (const tr of table.rows) {
      if (tr.classList.contains('mobile-category-row')) continue;
      const cells = tr.cells;
      if (cells.length < 4 || cells[0].tagName === 'TH') continue;
      const category = text(cells[1]);
      const src = cellTerm(cells[2], cellLang(cells[2], headers[2]));
      const dst = cellTerm(cells[3], cellLang(cells[3], headers[3]));
      if (!src.text && !dst.text) continue;
      let g = groups[groups.length - 1];
      if (!g || g.category !== category) groups.push((g = { category, items: [] }));
      g.items.push({ src, dst });
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

  return { source: 'tureng', pair, term: notFound ? '' : h1, audio, info, sections, suggestions, notFound };
}
