// Data layer: cache -> Tureng (via proxy) -> Wiktionary fallback.
import { AUTOCOMPLETE_URL, DEFAULT_PROXY_URL, SAME_ORIGIN_PROXY } from './config.js';
import { turengLookup } from './tureng.js';
import { wiktionaryLookup } from './wiktionary.js';
import { cache, settings } from './store.js';

// GitHub Pages is static-only, so there is no same-origin proxy there.
const hasSameOriginProxy = !location.hostname.endsWith('github.io');

export function proxyUrl() {
  const s = settings.get().proxyUrl;
  if (s !== null && s !== undefined) return s.trim(); // explicitly set (an empty string disables Tureng)
  return DEFAULT_PROXY_URL || (hasSameOriginProxy ? SAME_ORIGIN_PROXY : '');
}

/**
 * Resolves to a result object:
 * { source: 'tureng'|'wiktionary', term, audio, info, sections, suggestions, notFound, notice? }
 * notice: 'no_proxy' | 'tureng_failed' | 'offline_cache'
 */
export async function lookup(term, pair, { signal, fresh = false } = {}) {
  const cached = cache.get(term, pair);
  if (cached && !fresh) return cached;

  const proxy = proxyUrl();
  let notice = proxy ? 'tureng_failed' : 'no_proxy';
  let error = null;

  if (proxy) {
    try {
      const result = await turengLookup(term, pair, proxy, signal);
      if (!result.notFound || result.suggestions.length) {
        if (result.sections.length) cache.set(term, pair, result);
        return result;
      }
      notice = null; // Tureng answered, it just doesn't know the word; still try Wiktionary.
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      error = e;
      console.warn('[tureng]', e);
    }
  }

  try {
    const result = await wiktionaryLookup(term, pair, signal);
    return { ...result, notice };
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    if (cached) return { ...cached, notice: 'offline_cache' };
    throw error || e;
  }
}

let acController = null;
/** Tureng's autocomplete endpoint is public and CORS-enabled. */
export async function suggest(text, pair) {
  acController?.abort();
  acController = new AbortController();
  const url = new URL(AUTOCOMPLETE_URL);
  url.searchParams.set('t', text);
  url.searchParams.set('l', pair);
  const res = await fetch(url, { signal: acController.signal });
  if (!res.ok) return [];
  const list = await res.json();
  return Array.isArray(list) ? list.filter((s) => typeof s === 'string') : [];
}

export async function testProxy(url) {
  const r = await turengLookup('hello', 'entr', url);
  return r.sections.length > 0;
}
