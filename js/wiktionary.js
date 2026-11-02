// Fallback provider: English Wiktionary (CORS-enabled). Produces the same result shape as tureng.js.
import { WIKTIONARY_API, PAIRS, LANGS } from './config.js';

const POS = {
  Noun: 'n.', Verb: 'v.', Adjective: 'adj.', Adverb: 'adv.', Pronoun: 'pron.', Preposition: 'prep.',
  Conjunction: 'conj.', Interjection: 'interj.', Phrase: 'phr.', 'Prepositional phrase': 'phr.',
  Proverb: 'proverb', Idiom: 'idiom', Particle: 'part.', Determiner: 'det.', Numeral: 'num.',
  'Proper noun': 'prop. n.', Article: 'art.', Contraction: 'contr.', Abbreviation: 'abbr.',
  Suffix: 'suffix', Prefix: 'prefix', Postposition: 'postp.',
};

async function fetchWikitext(title, signal) {
  const url = new URL(WIKTIONARY_API);
  Object.entries({ action: 'parse', page: title, prop: 'wikitext', format: 'json', formatversion: '2', redirects: '1', origin: '*' })
    .forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`wiktionary_http_${res.status}`);
  const j = await res.json();
  return j.error ? null : j.parse?.wikitext || null;
}

function languageSection(wikitext, langName) {
  const re = new RegExp(`^==\\s*${langName}\\s*==\\s*$`, 'm');
  const m = re.exec(wikitext);
  if (!m) return '';
  const rest = wikitext.slice(m.index + m[0].length);
  const next = /^==[^=].*==\s*$/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

function templateParams(inner) {
  return inner.split('|').map((s) => s.trim());
}

// Turns wikitext markup into readable plain text.
export function cleanWikitext(s) {
  let out = s.replace(/<ref[^>]*\/>/g, '').replace(/<ref[\s\S]*?<\/ref>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  for (let i = 0; i < 8 && /\{\{[^{}]*\}\}/.test(out); i++) {
    out = out.replace(/\{\{([^{}]*)\}\}/g, (_, inner) => {
      const [name, ...params] = templateParams(inner);
      const positional = params.filter((p) => !p.includes('='));
      const n = name.toLowerCase();
      if (n === 'lb' || n === 'lbl' || n === 'label') {
        const labels = positional.slice(1).filter((p) => p && p !== '_' && p !== 'and' && p !== 'or');
        return labels.length ? `(${labels.join(', ')}) ` : '';
      }
      if (n === 'gloss' || n === 'gl') return `(${positional[0] || ''})`;
      if (n === 'l' || n === 'm' || n === 'll' || n === 'l-self') return positional[2] || positional[1] || '';
      if (n === 'w' || n === 'pedia') return positional[1] || positional[0] || '';
      if (n === 'q' || n === 'qualifier' || n === 'i') return `(${positional.join(', ')})`;
      if (n.endsWith(' of')) return `${n} ${positional[1] || ''}`.trim();
      return '';
    });
  }
  return out
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

// English entry -> translations into the target language (from {{trans-top}} tables).
function translationsFrom(enSection, term, targetLang) {
  const targetName = LANGS[targetLang].name;
  const groups = [];
  let pos = '';
  let gloss = '';
  for (const line of enSection.split('\n')) {
    const h = /^={3,5}\s*([^=]+?)\s*={3,5}\s*$/.exec(line);
    if (h) { if (POS[h[1]]) pos = h[1]; continue; }
    const top = /\{\{trans-top\|([^}]*)\}\}/.exec(line);
    if (top) { gloss = templateParams(top[1]).filter((p) => !p.includes('=')).join(', '); continue; }
    if (!new RegExp(`^\\*\\s*${targetName}:`).test(line)) continue;
    const words = [...line.matchAll(/\{\{tt?\+?(?:-check)?\|([a-z-]+)\|([^|}]+)/g)]
      .filter((m) => m[1] === targetLang)
      .map((m) => cleanWikitext(m[2]))
      .filter(Boolean);
    if (!words.length) continue;
    const category = [pos, gloss].filter(Boolean).join(' · ');
    let g = groups.find((x) => x.category === category);
    if (!g) groups.push((g = { category, items: [] }));
    for (const w of words) {
      g.items.push({ src: { text: term, type: POS[pos] || '', lang: 'en' }, dst: { text: w, type: '', lang: targetLang } });
    }
  }
  return groups;
}

// Entry in `lang` -> English definitions (lines starting with "# ").
function definitionsFrom(section, term, lang) {
  const groups = [];
  let pos = '';
  for (const line of section.split('\n')) {
    const h = /^={3,5}\s*([^=]+?)\s*={3,5}\s*$/.exec(line);
    if (h) { pos = POS[h[1]] ? h[1] : ''; continue; }
    if (!pos || !/^#\s/.test(line)) continue;
    const def = cleanWikitext(line.slice(1));
    if (!def) continue;
    let g = groups.find((x) => x.category === pos);
    if (!g) groups.push((g = { category: pos, items: [] }));
    g.items.push({ src: { text: term, type: POS[pos], lang }, dst: { text: def, type: '', lang: 'en' } });
  }
  return groups;
}

function ipaFrom(section, lang) {
  const all = [...section.matchAll(new RegExp(`\\{\\{IPA\\|${lang}\\|([^}]*)\\}\\}`, 'g'))]
    .flatMap((m) => templateParams(m[1]).filter((p) => p.startsWith('/') || p.startsWith('[')));
  return [...new Set(all)].slice(0, 3).join(', ');
}

const count = (groups) => groups.reduce((n, g) => n + g.items.length, 0);

export async function wiktionaryLookup(term, pair, signal) {
  const other = PAIRS[pair].langs.find((l) => l !== 'en');
  const titles = [...new Set([term, term.toLowerCase()])];
  let wikitext = null;
  let title = term;
  for (const t of titles) {
    wikitext = await fetchWikitext(t, signal);
    if (wikitext) { title = t; break; }
  }
  const empty = { source: 'wiktionary', pair, term, audio: [], info: [], sections: [], suggestions: [], notFound: true };
  if (!wikitext) return empty;

  const sections = [];
  const info = [];
  const en = languageSection(wikitext, 'English');
  const foreign = languageSection(wikitext, LANGS[other].name);

  if (en) {
    let groups = translationsFrom(en, title, other);
    // Large entries ("run", "set", ...) keep translations on a "<word>/translations" subpage.
    if (!groups.length && /translation subpage|trans-see/i.test(en)) {
      const sub = await fetchWikitext(`${title}/translations`, signal).catch(() => null);
      if (sub) groups = translationsFrom(languageSection(sub, 'English') || sub, title, other);
    }
    if (groups.length) sections.push({ title: 'Meanings', langs: ['en', other], groups, count: count(groups) });
    const ipa = ipaFrom(en, 'en');
    if (ipa) info.push({ kind: 'td-ipa', label: 'IPA (EN)', value: ipa, links: [] });
  }
  if (foreign) {
    const groups = definitionsFrom(foreign, title, other);
    if (groups.length) sections.push({ title: 'Meanings', langs: [other, 'en'], groups, count: count(groups), kind: 'definitions' });
    const ipa = ipaFrom(foreign, other);
    if (ipa) info.push({ kind: 'td-ipa', label: `IPA (${LANGS[other].short})`, value: ipa, links: [] });
  }
  // Pure-English page without translation tables: show English definitions so the user still gets something.
  if (!sections.length && en) {
    const groups = definitionsFrom(en, title, 'en');
    if (groups.length) sections.push({ title: 'Definitions (EN)', langs: ['en', 'en'], groups, count: count(groups), kind: 'definitions' });
  }
  return sections.length ? { ...empty, term: title, info, sections, notFound: false } : empty;
}
