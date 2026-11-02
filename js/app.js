import { PAIRS, DEFAULT_PAIR, LANGS, ACCENTS, APP_VERSION, pairUrl } from './config.js';
import { lookup, suggest, proxyUrl, testProxy, moreSentences, audioUrl } from './api.js';
import { settings, history as hist, favorites, cache } from './store.js';
import { pronounce, speak, preloadAudio, audioDiagnostics } from './speech.js';

// ---------------------------------------------------------------- helpers
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ICON = {
  speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
  quote: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h4v4c0 3-1.5 5-4 6M15 7h4v4c0 3-1.5 5-4 6"/></svg>',
  external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
};

const INFO_LABELS = {
  meaning: 'Meaning', 'pronunciation (ipa)': 'IPA', 'part of speech': 'Part of speech',
  synonyms: 'Synonyms', antonyms: 'Antonyms',
};

const els = {
  appbar: $('#appbar'), home: $('#homeBtn'), back: $('#backBtn'), form: $('#searchForm'), input: $('#q'), clear: $('#clearBtn'),
  settingsBtn: $('#settingsBtn'), pairs: $('#pairs'), suggest: $('#suggest'), view: $('#view'),
  scrim: $('#scrim'), sheet: $('#sheet'), toast: $('#toast'),
};

const state = {
  pair: PAIRS[settings.get().pair] ? settings.get().pair : DEFAULT_PAIR,
  q: '',
  result: null,
  rows: [],
  controller: null,
};

let toastTimer;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1800);
}

// ---------------------------------------------------------------- routing (#/<pair>/<term>)
function parseHash() {
  const m = /^#\/([a-z]{4})\/(.+)$/.exec(location.hash);
  if (!m || !PAIRS[m[1]]) return { pair: state.pair, q: '' };
  let q = m[2];
  try { q = decodeURIComponent(q); } catch { /* keep raw */ }
  return { pair: m[1], q: q.trim() };
}

function navigate(q, pair = state.pair, { replace = false } = {}) {
  q = (q || '').trim();
  const hash = q ? `#/${pair}/${encodeURIComponent(q)}` : '#';
  const depth = (history.state?.depth || 0) + (replace ? 0 : 1);
  if (replace) history.replaceState({ depth: history.state?.depth || 0 }, '', hash);
  else history.pushState({ depth }, '', hash);
  route();
}

// Logo: from a result go to the home screen; on the home screen open the keyboard for a new search.
function goHome() {
  if (state.q) {
    navigate('');
    window.scrollTo(0, 0);
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    els.input.focus(); // inside the tap handler, so iOS opens the keyboard
  }
}

function goBack() {
  if ((history.state?.depth || 0) > 0) history.back();
  else navigate('', state.pair, { replace: true });
}

function route() {
  const { pair, q } = parseHash();
  setPair(pair, { silent: true });
  state.q = q;
  els.input.value = q;
  els.clear.hidden = !q;
  // Back only when there is an in-app page to return to; the logo always leads home.
  els.back.hidden = !q || !(history.state?.depth > 0);
  hideSuggest();
  closeSheet();
  if (q) search(q, pair);
  else renderHome();
}

// ---------------------------------------------------------------- pair selector
function renderPairs() {
  els.pairs.innerHTML = Object.values(PAIRS)
    .map((p) => `<button class="pair" type="button" data-act="pair" data-pair="${p.code}" aria-pressed="${p.code === state.pair}">${p.label}</button>`)
    .join('');
}

function setPair(pair, { silent = false } = {}) {
  if (!PAIRS[pair]) return;
  state.pair = pair;
  settings.set({ pair });
  els.pairs.querySelectorAll('.pair').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pair === pair)));
  if (!silent && state.q) navigate(state.q, pair, { replace: true });
}

// ---------------------------------------------------------------- home
function listItem({ q, pair, preview }, kind) {
  const sub = preview ? `<span class="sub">${esc(preview)}</span>` : '';
  return `<li>
    <button class="go" data-act="search" data-q="${esc(q)}" data-pair="${pair}">
      <span class="badge">${PAIRS[pair]?.label.replace(' ⇄ ', '-') || pair}</span>
      <span class="txt"><span class="q">${esc(q)}</span>${sub}</span>
    </button>
    <button class="del" data-act="${kind === 'fav' ? 'unfav' : 'del-history'}" data-q="${esc(q)}" data-pair="${pair}" aria-label="Remove">${ICON.x}</button>
  </li>`;
}

function renderHome() {
  state.result = null;
  document.title = 'Self Tureng';
  const favs = favorites.list();
  const recent = hist.list();
  let html = '';
  if (!favs.length && !recent.length) {
    html += `<div class="hero">
      <img class="logo" src="icons/icon-192.png" alt="">
      <h2>Self Tureng</h2>
      <p>Ad-free dictionary. Type a word, listen to the<br>pronunciation, save your favorites.</p>
      <div class="chips">${['hello', 'take off', 'merhaba', 'serendipity'].map((w) => `<button class="chip" data-act="search" data-q="${w}" data-pair="entr">${w}</button>`).join('')}</div>
    </div>`;
  }
  if (favs.length) {
    html += `<div class="section-title"><span>Favorites</span><span class="count">${favs.length}</span></div>
      <ul class="list card">${favs.map((f) => listItem(f, 'fav')).join('')}</ul>`;
  }
  if (recent.length) {
    html += `<div class="section-title"><span>Recent searches</span><button class="link-btn" data-act="clear-history">Clear</button></div>
      <ul class="list card">${recent.slice(0, 30).map((h) => listItem(h, 'history')).join('')}</ul>`;
  }
  els.view.innerHTML = html;
}

// ---------------------------------------------------------------- search & results
function renderLoading(q) {
  const line = (w) => `<div class="sk" style="height:16px;width:${w}%;margin:14px 16px"></div>`;
  els.view.innerHTML = `<div class="card term-card"><div class="term-top"><h1>${esc(q)}</h1></div>
    <div class="pron"><div class="sk" style="height:36px;width:88px;border-radius:999px"></div><div class="sk" style="height:36px;width:88px;border-radius:999px"></div></div></div>
    <div class="section-title"><span>Meanings</span></div>
    <div class="card">${[70, 55, 80, 60, 75, 50].map(line).join('')}</div>`;
}

async function search(q, pair) {
  state.controller?.abort();
  const controller = (state.controller = new AbortController());
  renderLoading(q);
  window.scrollTo(0, 0);
  try {
    const result = await lookup(q, pair, { signal: controller.signal });
    if (controller.signal.aborted) return;
    state.result = result;
    if (result.sections.length) {
      hist.add(q, pair);
      renderResult(result);
    } else {
      renderNotFound(q, pair, result);
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.error(e);
    renderError(q);
  }
}

function speakerSide(item) {
  if (item.definition) return item.src; // dictionary definitions: pronounce the headword, not the sentence
  const foreign = PAIRS[state.pair].foreign;
  if (item.src.lang === foreign) return item.src;
  if (item.dst.lang === foreign) return item.dst;
  return item.src;
}

function ttsLocale(lang) {
  return lang === 'en' ? settings.get().accent : LANGS[lang]?.tts || 'en-US';
}

const ROW_LIMIT = 40;
const SENTENCE_LIMIT = 25;

// ---------------------------------------------------------------- example sentences
const sentenceHtml = (parts) => parts.map(([t, bold]) => (bold ? `<b>${esc(t)}</b>` : esc(t))).join('');
const sentenceText = (parts) => parts.map(([t]) => t).join('');

/** Two-line example (source + translation); the line in the pair's "foreign" language gets a speaker. */
function sentenceBlock(cls, ex, langs) {
  const foreign = PAIRS[state.pair].foreign;
  const line = (parts, lang, role) => {
    if (!parts.length) return '';
    const k = lang === foreign ? state.sentences.push({ text: sentenceText(parts), lang }) - 1 : -1;
    const say = k >= 0 ? `<button class="ex-say" data-act="say-sentence" data-k="${k}" aria-label="Pronounce sentence">${ICON.speaker}</button>` : '';
    return `<p class="${role}" lang="${lang}"><span>${sentenceHtml(parts)}</span>${say}</p>`;
  };
  return `<div class="${cls}">${line(ex.src, langs[0], 'ex-a')}${line(ex.dst, langs[1], 'ex-b')}</div>`;
}

function hasExamples(result) {
  return result.sections.some((s) => s.groups.some((g) => g.items.some((it) => it.example)));
}

function examplesToggle(result) {
  if (!hasExamples(result)) return '';
  const on = settings.get().showExamples;
  return `<label class="ex-toggle"><span>Example sentences</span>
    <span class="switch"><input type="checkbox" role="switch" data-setting="showExamples" ${on ? 'checked' : ''}><span></span></span></label>`;
}

function moreSentencesBlock(result) {
  if (result.source !== 'tureng' || state.pair !== 'entr' || !result.hasMoreSentences) return '';
  return `<section id="sentences"><button class="btn more-sent" data-act="load-sentences">${ICON.quote} More example sentences</button></section>`;
}

function renderSentences(data, full = false) {
  const node = $('#sentences');
  if (!node) return;
  state.moreSentences = data;
  if (!data.count) {
    node.innerHTML = '<p class="footer-src">Tureng has no more example sentences for this word.</p>';
    return;
  }
  let shown = 0;
  let html = '';
  for (const g of data.groups) {
    if (!full && shown >= SENTENCE_LIMIT) break;
    let pairs = '';
    for (const p of g.pairs) {
      if (!full && shown >= SENTENCE_LIMIT) break;
      pairs += sentenceBlock('sent', p, data.langs);
      shown++;
    }
    const type = g.type ? `<span class="type">${esc(g.type)}</span>` : '';
    html += `<div class="group"><h3 class="cat">${esc(g.src)} → ${esc(g.dst)} ${type}</h3>${pairs}</div>`;
  }
  const more = !full && data.count > shown ? `<button class="more" data-act="all-sentences">Show all (${data.count})</button>` : '';
  node.innerHTML = `<div class="section-title"><span>Example sentences</span><span class="count">${data.count} sentences</span></div>
    <div class="card res-card">${html}${more}</div>`;
}

async function loadSentences() {
  const node = $('#sentences');
  if (!node) return;
  const q = state.q;
  node.innerHTML = `<div class="section-title"><span>Example sentences</span></div>
    <div class="card">${[80, 60, 75].map((w) => `<div class="sk" style="height:16px;width:${w}%;margin:14px 16px"></div>`).join('')}</div>`;
  try {
    const data = await moreSentences(q, state.pair);
    if (state.q === q) renderSentences(data);
  } catch (e) {
    console.warn('[sentences]', e);
    if (state.q === q) {
      node.innerHTML = `<div class="notice">${ICON.info}<div>Could not load example sentences. <button data-act="load-sentences">Retry</button></div></div>`;
    }
  }
}

function renderSection(section, sIdx, full = false) {
  const [l1, l2] = section.langs;
  let shown = 0;
  let groupsHtml = '';
  for (const g of section.groups) {
    if (!full && shown >= ROW_LIMIT) break;
    let rowsHtml = '';
    for (const item of g.items) {
      if (!full && shown >= ROW_LIMIT) break;
      const i = state.rows.push(section.kind === 'definitions' ? { ...item, definition: true } : item) - 1;
      shown++;
      // Definition sentences are plain text; single words/phrases are tappable to look them up.
      const cell = (t, cls) => {
        const word = section.kind === 'definitions' && cls === 'dst'
          ? `<span class="w">${esc(t.text)}</span>`
          : `<button class="w" data-act="search" data-q="${esc(t.text)}">${esc(t.text)}</button>`;
        return `<div class="cell ${cls}">${word}${t.type ? `<span class="type">${esc(t.type)}</span>` : ''}</div>`;
      };
      // Tureng's example pairs are always English first, then the other language — even for TR→EN rows.
      const example = item.example ? sentenceBlock('ex', item.example, PAIRS[state.pair].langs) : '';
      rowsHtml += `<div class="row${example ? ' has-ex' : ''}" data-act="row" data-i="${i}">${cell(item.src, 'src')}${cell(item.dst, 'dst')}<button class="say" data-act="say" data-i="${i}" aria-label="Pronounce: ${esc(speakerSide(state.rows[i]).text)}">${ICON.speaker}</button>${example}</div>`;
    }
    groupsHtml += `<div class="group">${g.category ? `<h3 class="cat">${esc(g.category)}</h3>` : ''}${rowsHtml}</div>`;
  }
  const more = !full && section.count > shown
    ? `<button class="more" data-act="more" data-s="${sIdx}">Show all (${section.count})</button>` : '';
  const head = l1 && l2 ? `<div class="lang-head"><span>${LANGS[l1]?.name || l1}</span><span>${LANGS[l2]?.name || l2}</span><span></span></div>` : '';
  return `<section data-section="${sIdx}">
    <div class="section-title"><span>${esc(section.title)}</span><span class="count">${section.count} results</span></div>
    <div class="card res-card${section.kind === 'definitions' ? ' defs' : ''}">${head}${groupsHtml}${more}</div>
  </section>`;
}

function pronButtons(result) {
  const termLang = result.sections[0]?.langs[0] || PAIRS[state.pair].langs[0];
  const accent = settings.get().accent;
  let buttons;
  if (result.audio.length) {
    // Preferred English accent first.
    const audio = [...result.audio].sort((a, b) => (b.locale === accent) - (a.locale === accent));
    buttons = audio.map((a) => ({ url: audioUrl(a.src), locale: a.locale }));
    preloadAudio(buttons.map((b) => b.url).filter(Boolean));
  } else if (termLang === 'en') {
    buttons = ['en-US', 'en-GB'].map((locale) => ({ locale }));
  } else {
    buttons = [{ locale: LANGS[termLang]?.tts || 'en-US' }];
  }
  state.pron = buttons;
  return buttons
    .map((b, k) => {
      const a = ACCENTS[b.locale] || { flag: '', label: b.locale };
      return `<button data-act="pron" data-k="${k}" aria-label="Pronounce ${a.label}">${ICON.speaker}<span class="flag">${a.flag}</span>${a.label}</button>`;
    })
    .join('');
}

function infoBlock(result) {
  if (!result.info.length) return '';
  return `<dl class="term-info">${result.info
    .map((x) => {
      const label = INFO_LABELS[x.label.toLowerCase()] || x.label;
      const value = x.links.length
        ? x.links.map((l) => `<button data-act="search" data-q="${esc(l)}">${esc(l)}</button>`).join('<span>·</span>')
        : esc(x.value);
      return `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
    })
    .join('')}</dl>`;
}

function noticeBlock(result) {
  const map = {
    no_proxy: `Tureng proxy is not set up — showing results from Wiktionary. <button data-act="settings">Settings</button>`,
    tureng_failed: `Could not reach Tureng — showing results from Wiktionary. <button data-act="retry">Retry</button>`,
    offline_cache: 'Offline — showing a saved result.',
  };
  return result.notice && map[result.notice] ? `<div class="notice">${ICON.info}<div>${map[result.notice]}</div></div>` : '';
}

function sourceFooter(result, q) {
  if (result.source === 'wiktionary') {
    return `<p class="footer-src">Source: <a href="https://en.wiktionary.org/wiki/${encodeURIComponent(result.term || q)}" target="_blank" rel="noopener">Wiktionary</a> (CC BY-SA) · <a href="${pairUrl(state.pair, q)}" target="_blank" rel="noopener">Open in Tureng</a></p>`;
  }
  return `<p class="footer-src">Source: <a href="${pairUrl(state.pair, q)}" target="_blank" rel="noopener">tureng.com</a></p>`;
}

function renderResult(result) {
  state.rows = [];
  state.sentences = [];
  state.moreSentences = null;
  els.view.classList.toggle('hide-ex', !settings.get().showExamples);
  const term = result.term || state.q;
  document.title = `${term} — Self Tureng`;
  const fav = favorites.has(state.q, state.pair);
  els.view.innerHTML = `${noticeBlock(result)}
    <div class="card term-card">
      <div class="term-top">
        <h1 lang="${result.sections[0]?.langs[0] || ''}">${esc(term)}</h1>
        <button class="star" data-act="star" aria-pressed="${fav}" aria-label="Add to favorites">${ICON.star}</button>
      </div>
      <div class="pron">${pronButtons(result)}</div>
      ${infoBlock(result)}
      ${examplesToggle(result)}
    </div>
    ${result.sections.map((s, i) => renderSection(s, i)).join('')}
    ${moreSentencesBlock(result)}
    ${sourceFooter(result, state.q)}`;
}

function renderNotFound(q, pair, result) {
  const sugg = result.suggestions || [];
  els.view.innerHTML = `${noticeBlock(result)}<div class="empty">
    <h2>${sugg.length ? 'Did you mean?' : `No results for “${esc(q)}”`}</h2>
    ${sugg.length ? '' : '<p>Check the spelling or try another language pair.</p>'}
    <div class="chips">${sugg.map((s) => `<button class="chip" data-act="search" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <p style="margin-top:24px"><a class="btn secondary" href="${pairUrl(pair, q)}" target="_blank" rel="noopener">${ICON.external} Open in Tureng</a></p>
  </div>`;
}

function renderError(q) {
  const offline = !navigator.onLine;
  els.view.innerHTML = `<div class="empty">
    <h2>${offline ? 'You are offline' : 'Something went wrong'}</h2>
    <p>${offline ? 'Try again when you are back online.' : `Could not load results for “${esc(q)}”.`}</p>
    <p style="margin-top:20px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
      <button class="btn" data-act="retry">Try again</button>
      <a class="btn secondary" href="${pairUrl(state.pair, q)}" target="_blank" rel="noopener">Open in Tureng</a>
    </p>
  </div>`;
}

// ---------------------------------------------------------------- autocomplete
let acTimer;
let acSeq = 0;
function hideSuggest() {
  clearTimeout(acTimer);
  acSeq++;
  els.suggest.hidden = true;
  els.suggest.innerHTML = '';
}

function showSuggest(items, typed) {
  if (!items.length || document.activeElement !== els.input) return hideSuggest();
  const low = typed.toLowerCase();
  els.suggest.innerHTML = items
    .slice(0, 10)
    .map((s) => {
      const label = s.toLowerCase().startsWith(low) ? `<mark>${esc(s.slice(0, typed.length))}</mark>${esc(s.slice(typed.length))}` : esc(s);
      return `<button type="button" role="option" data-act="search" data-q="${esc(s)}">${ICON.search}<span>${label}</span></button>`;
    })
    .join('');
  els.suggest.style.top = `${els.appbar.getBoundingClientRect().bottom}px`;
  els.suggest.hidden = false;
}

function onInput() {
  const v = els.input.value;
  els.clear.hidden = !v;
  clearTimeout(acTimer);
  const typed = v.trim();
  if (typed.length < 2) return hideSuggest();
  const seq = ++acSeq;
  acTimer = setTimeout(async () => {
    try {
      const items = await suggest(typed, state.pair);
      if (seq === acSeq) showSuggest(items, typed);
    } catch { /* autocomplete is best-effort */ }
  }, 140);
}

// ---------------------------------------------------------------- bottom sheet
function openSheet(html) {
  els.sheet.innerHTML = `<div class="grab"></div>${html}`;
  els.sheet.hidden = false;
  els.scrim.hidden = false;
}
function closeSheet() {
  els.sheet.hidden = true;
  els.scrim.hidden = true;
  els.sheet.innerHTML = '';
}

function openRowSheet(i) {
  const item = state.rows[i];
  if (!item) return;
  state.sheetItem = item;
  const opt = (act, icon, label, sub = '') => `<button data-act="${act}">${icon}<span>${label}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</button>`;
  const lang = (t) => LANGS[t.lang]?.short || '';
  openSheet(`<h3>${esc(item.src.text)} → ${esc(item.dst.text)}</h3>
    <div class="actions">
      ${opt('sheet-say-src', ICON.speaker, `Pronounce “${esc(item.src.text)}”`, lang(item.src))}
      ${opt('sheet-say-dst', ICON.speaker, `Pronounce “${esc(item.dst.text)}”`, lang(item.dst))}
      ${opt('sheet-copy', ICON.copy, 'Copy')}
      ${opt('sheet-search-src', ICON.search, `Search “${esc(item.src.text)}”`)}
      ${opt('sheet-search-dst', ICON.search, `Search “${esc(item.dst.text)}”`)}
    </div>
    <button class="cancel" data-act="close-sheet">Close</button>`);
}

function openSettings() {
  const s = settings.get();
  const seg = (name, options, current) => `<div class="seg" role="group">${options
    .map(([v, l]) => `<button data-act="set" data-k="${name}" data-v="${v}" aria-pressed="${v === current}">${l}</button>`).join('')}</div>`;
  openSheet(`<h3>Settings</h3>
    <div class="form-group">
      <div class="form-row form-col">
        <span class="lbl"><b>Tureng proxy URL</b></span>
        <input type="url" id="proxyInput" inputmode="url" autocapitalize="none" autocorrect="off" spellcheck="false"
          placeholder="https://tureng-proxy.<name>.workers.dev" value="${esc(s.proxyUrl ?? proxyUrl())}">
        <div style="display:flex;gap:8px">
          <button class="btn" data-act="save-proxy" style="flex:1">Save</button>
          <button class="btn secondary" data-act="test-proxy" style="flex:1">Test</button>
        </div>
        <span id="proxyStatus" class="sub" style="color:var(--muted);font-size:13px"></span>
      </div>
    </div>
    <p class="form-hint">Your Cloudflare Worker URL (see README). Leave empty to use Wiktionary only.</p>
    <div class="form-group">
      <div class="form-row"><span class="lbl">English accent</span>${seg('accent', [['en-US', 'US'], ['en-GB', 'UK'], ['en-AU', 'AU']], s.accent)}</div>
      <div class="form-row"><span class="lbl">Theme</span>${seg('theme', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], s.theme)}</div>
    </div>
    <div class="form-group actions" style="display:grid">
      <button data-act="clear-history" class="danger">Clear search history</button>
      <button data-act="clear-cache" class="danger">Clear offline cache</button>
    </div>
    <p class="form-hint" style="text-align:center;margin-top:8px">Self Tureng v${APP_VERSION} · Data: tureng.com, Wiktionary</p>
    <p class="form-hint" style="text-align:center;font-size:11px">${audioInfo()}</p>
    <button class="cancel" data-act="close-sheet">Close</button>`);
}

function audioInfo() {
  const d = audioDiagnostics();
  const err = d.lastError ? ` · last error: ${esc(d.lastError)} (${d.lastErrorAgo}s ago)` : '';
  return `Audio: ${d.supported ? 'web audio' : 'unsupported'} · session ${d.session} · state ${d.state} · contexts ${d.contexts} · plays ${d.plays}${err}`;
}

function applyTheme(theme) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    if (theme === 'auto') m.content = m.media.includes('dark') ? '#1c1c1e' : '#b71c1c';
    else m.content = theme === 'dark' ? '#1c1c1e' : '#b71c1c';
  });
}

// ---------------------------------------------------------------- actions
async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
    toast('Copied');
  } catch {
    toast('Copy failed');
  }
}

function flash(btn) {
  btn?.classList.add('playing');
  setTimeout(() => btn?.classList.remove('playing'), 900);
}

const actions = {
  search: (el) => {
    hideSuggest();
    els.input.blur();
    navigate(el.dataset.q, el.dataset.pair || state.pair);
  },
  pair: (el) => setPair(el.dataset.pair),
  row: (el, ev) => {
    if (ev.target.closest('button')) return;
    openRowSheet(+el.dataset.i);
  },
  say: (el) => {
    const t = speakerSide(state.rows[+el.dataset.i]);
    flash(el);
    speak(t.text, ttsLocale(t.lang));
  },
  pron: (el) => {
    const b = state.pron?.[+el.dataset.k];
    if (!b) return;
    flash(el);
    pronounce({ url: b.url, text: state.result?.term || state.q, locale: b.locale });
  },
  star: (el) => {
    const first = state.result?.sections[0]?.groups[0]?.items[0];
    const preview = state.result?.sections[0]?.groups.flatMap((g) => g.items).slice(0, 3)
      .map((it) => (it.src.text.toLowerCase() === state.q.toLowerCase() ? it.dst.text : it.src.text)).join(', ') || first?.dst.text || '';
    const on = favorites.toggle(state.q, state.pair, preview);
    el.setAttribute('aria-pressed', String(on));
    toast(on ? 'Added to favorites' : 'Removed from favorites');
  },
  more: (el) => {
    const idx = +el.dataset.s;
    const section = state.result.sections[idx];
    const node = els.view.querySelector(`[data-section="${idx}"]`);
    node.outerHTML = renderSection(section, idx, true);
  },
  retry: () => {
    if (state.q) lookupFresh();
  },
  'say-sentence': (el) => {
    const s = state.sentences[+el.dataset.k];
    if (!s) return;
    flash(el);
    speak(s.text, ttsLocale(s.lang));
  },
  'load-sentences': () => loadSentences(),
  'all-sentences': () => renderSentences(state.moreSentences, true),
  'del-history': (el) => { hist.remove(el.dataset.q, el.dataset.pair); renderHome(); },
  unfav: (el) => { favorites.toggle(el.dataset.q, el.dataset.pair); renderHome(); },
  'clear-history': () => {
    hist.clear();
    toast('History cleared');
    if (!state.q) renderHome();
  },
  'clear-cache': () => { cache.clear(); toast('Cache cleared'); },
  settings: () => openSettings(),
  'close-sheet': () => closeSheet(),
  set: (el) => {
    const { k, v } = el.dataset;
    settings.set({ [k]: v });
    el.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
    if (k === 'theme') applyTheme(v);
  },
  'save-proxy': () => {
    const v = $('#proxyInput').value.trim();
    settings.set({ proxyUrl: v });
    toast(v ? 'Proxy saved' : 'Proxy disabled — using Wiktionary');
    closeSheet();
    if (state.q) lookupFresh();
  },
  'test-proxy': async () => {
    const status = $('#proxyStatus');
    const v = $('#proxyInput').value.trim();
    if (!v) { status.textContent = 'Enter a URL first.'; return; }
    status.textContent = 'Testing…';
    try {
      status.textContent = (await testProxy(v)) ? '✅ Tureng answered this request.' : '⚠️ Got a response but no results.';
    } catch (e) {
      status.textContent = `❌ Tureng blocked this request (${e.message}). Blocked lookups fall back to Wiktionary.`;
    }
  },
  'sheet-say-src': () => { const t = state.sheetItem.src; speak(t.text, ttsLocale(t.lang)); },
  'sheet-say-dst': () => { const t = state.sheetItem.dst; speak(t.text, ttsLocale(t.lang)); },
  'sheet-copy': () => { const it = state.sheetItem; copyText(`${it.src.text} — ${it.dst.text}`); closeSheet(); },
  'sheet-search-src': () => { closeSheet(); navigate(state.sheetItem.src.text); },
  'sheet-search-dst': () => { closeSheet(); navigate(state.sheetItem.dst.text); },
};

async function lookupFresh() {
  state.controller?.abort();
  const controller = (state.controller = new AbortController());
  renderLoading(state.q);
  try {
    const result = await lookup(state.q, state.pair, { signal: controller.signal, fresh: true });
    state.result = result;
    if (result.sections.length) renderResult(result);
    else renderNotFound(state.q, state.pair, result);
  } catch (e) {
    if (e.name !== 'AbortError') renderError(state.q);
  }
}

// ---------------------------------------------------------------- wiring
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el, ev);
});

// Settings switches rendered inside views (e.g. "Example sentences").
document.addEventListener('change', (ev) => {
  const input = ev.target.closest('input[data-setting]');
  if (!input) return;
  settings.set({ [input.dataset.setting]: input.checked });
  if (input.dataset.setting === 'showExamples') els.view.classList.toggle('hide-ex', !input.checked);
});

// Keep the input focused while tapping a suggestion (prevents the list from vanishing on blur).
els.suggest.addEventListener('pointerdown', (e) => e.preventDefault());

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = els.input.value.trim();
  if (!q) return;
  hideSuggest();
  els.input.blur();
  navigate(q, state.pair, { replace: q === state.q });
});
els.input.addEventListener('input', onInput);
els.input.addEventListener('focus', () => { if (els.input.value.trim().length >= 2) onInput(); });
els.input.addEventListener('blur', () => setTimeout(hideSuggest, 120));
els.clear.addEventListener('click', () => {
  els.input.value = '';
  els.clear.hidden = true;
  hideSuggest();
  els.input.focus();
});
els.back.addEventListener('click', goBack);
els.home.addEventListener('click', goHome);
els.settingsBtn.addEventListener('click', openSettings);
els.scrim.addEventListener('click', closeSheet);
window.addEventListener('popstate', route);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeSheet(); hideSuggest(); }
});

// Sticky category headers sit right under the app bar.
const setBarHeight = () => document.documentElement.style.setProperty('--appbar-h', `${els.appbar.offsetHeight}px`);
new ResizeObserver(setBarHeight).observe(els.appbar);
setBarHeight();

// ---------------------------------------------------------------- boot
applyTheme(settings.get().theme);
renderPairs();
{
  // Support ?q=word (&pair=entr) links, e.g. from iOS Shortcuts.
  const params = new URLSearchParams(location.search);
  const q = params.get('q');
  if (q) {
    const pair = PAIRS[params.get('pair')] ? params.get('pair') : state.pair;
    history.replaceState({ depth: 0 }, '', `${location.pathname}#/${pair}/${encodeURIComponent(q.trim())}`);
  } else {
    history.replaceState({ depth: history.state?.depth || 0 }, '', location.href);
  }
}
route();

// Offline support only on the deployed (HTTPS) site; on localhost it would serve stale files while developing.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
}
