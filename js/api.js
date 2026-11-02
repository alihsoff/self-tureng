// Data layer: cache -> Tureng (via proxy) -> Wiktionary fallback.
import { AUTOCOMPLETE_URL, DEFAULT_PROXY_URL, SAME_ORIGIN_PROXY } from './config.js';
import { turengLookup, turengSentences } from './tureng.js';
import { wiktionaryLookup } from './wiktionary.js';
import { cache, settings } from './store.js';

// Hosts that serve /proxy on their own domain: the Cloudflare Worker itself, Vercel (server-side rewrite to
// the Worker, so phones never contact workers.dev, which some ISPs block) and the local dev mock.
const host = location.hostname;
const usesSameOriginProxy = ['workers.dev', 'pages.dev', 'vercel.app'].some((d) => host.endsWith(d)) ||
  ['localhost', '127.0.0.1', '[::1]'].includes(host);

export function proxyUrl() {
  const s = settings.get().proxyUrl;
  if (s !== null && s !== undefined) return s.trim(); // explicitly set (an empty string disables Tureng)
  return usesSameOriginProxy ? SAME_ORIGIN_PROXY : DEFAULT_PROXY_URL;
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

/** Tureng's full example-sentence list for a term (EN-TR only), cached per device like lookups. */
export async function moreSentences(term, pair, { signal } = {}) {
  const cacheSlot = `sentences-${pair}`;
  const cached = cache.get(term, cacheSlot);
  if (cached) return cached;
  const proxy = proxyUrl();
  if (!proxy) throw new Error('no_proxy');
  const result = await turengSentences(term, pair, proxy, signal);
  if (result.count) cache.set(term, cacheSlot, result);
  return result;
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

// Uses a unique nonsense term: it is never in the proxy's cache, so the test really reaches tureng.com
// (a "Term not found" page parses fine and counts as success).
export async function testProxy(url) {
  await turengLookup(`zzq${Date.now().toString(36)}`, 'entr', url);
  return true;
}
