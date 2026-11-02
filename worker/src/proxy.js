// Minimal CORS proxy for Tureng Mobile, shared by every deploy target:
// Cloudflare Worker (worker/src/site.js, worker/src/index.js), Cloudflare Pages (functions/proxy.js), Vercel (api/proxy.js).
// GET ?pair=entr&q=hello  ->  results column of https://tureng.com/en/turkish-english/hello as HTML.
// GET ?pair=entr&q=hello&kind=sentences  ->  https://tureng.com/en/turkish-english-sentences/hello
// GET ?kind=audio&path=en-US/xx/<uuid>.mp3  ->  https://voicesr2.tureng.com/files/en-US/xx/<uuid>.mp3
// It only forwards requests for the four dictionary pages; it is not an open proxy.

const PAIRS = {
  entr: 'turkish-english',
  ende: 'german-english',
  enfr: 'french-english',
  enes: 'spanish-english',
};
const CACHE_SECONDS = 60 * 60 * 24 * 7;

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
  const allowOrigin = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : '';
  return {
    allowed: allowed.includes('*') || !origin || allowed.includes(origin),
    headers: {
      ...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin } : {}),
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  };
}

const json = (status, body, headers) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

// Keep only the results column and drop scripts: smaller payload for phones, nothing executable.
// Match the actual <div class="..."> tags; the class names also appear earlier in the page's CSS.
function slim(html) {
  const left = /<div\b[^>]*class="[^"]*\btureng-searchresults-col-left\b[^"]*"/i.exec(html);
  if (!left) return null;
  const right = /<div\b[^>]*class="[^"]*\btureng-searchresults-col-right\b[^"]*"/i.exec(html.slice(left.index));
  const end = right ? left.index + right.index : html.length;
  return html
    .slice(left.index, end)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
}

// Tureng pronunciation files, e.g. path=en-US/d5/d5c81016-4ad2-40b3-8768-5886451afe0a.mp3.
// Served with CORS so the app can play them through Web Audio (which, unlike <audio>, doesn't put a
// "Now Playing" player on the iOS lock screen). Only this exact file pattern is allowed.
const AUDIO_PATH = /^[a-z]{2}-[A-Z]{2}\/[0-9a-f]{2}\/[0-9a-f-]{36}\.mp3$/;
const AUDIO_CACHE_SECONDS = 60 * 60 * 24 * 30;

async function proxyAudio(url, cors, ctx) {
  const path = url.searchParams.get('path') || '';
  if (!AUDIO_PATH.test(path)) return json(400, { error: 'bad_request' }, cors.headers);
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(`https://tureng-proxy.cache/audio/${path}`);
  const hit = cache ? await cache.match(cacheKey) : null;
  let res = hit;
  if (!res) {
    const upstream = await fetch(`https://voicesr2.tureng.com/files/${path}`);
    if (!upstream.ok) return json(502, { error: 'upstream_unavailable', status: upstream.status }, cors.headers);
    res = new Response(await upstream.arrayBuffer(), {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': `public, max-age=${AUDIO_CACHE_SECONDS}, s-maxage=${AUDIO_CACHE_SECONDS}` },
    });
    if (cache) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  }
  res = new Response(res.body, res);
  Object.entries(cors.headers).forEach(([k, v]) => res.headers.set(k, v));
  res.headers.set('X-Cache', hit ? 'HIT' : 'MISS');
  return res;
}

export async function handleProxy(request, env = {}, ctx = { waitUntil() {} }) {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors.headers });
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' }, cors.headers);
  if (!cors.allowed) return json(403, { error: 'origin_not_allowed' }, cors.headers);

  const url = new URL(request.url);
  if (url.searchParams.get('kind') === 'audio') return proxyAudio(url, cors, ctx);
  const pair = url.searchParams.get('pair') || 'entr';
  const q = (url.searchParams.get('q') || '').trim();
  // kind=sentences -> Tureng's "More Sentences" page, which only exists for EN-TR.
  const kind = url.searchParams.get('kind') || 'terms';
  if (!PAIRS[pair] || !q || q.length > 120) return json(400, { error: 'bad_request' }, cors.headers);
  if (kind !== 'terms' && !(kind === 'sentences' && pair === 'entr')) return json(400, { error: 'bad_request' }, cors.headers);
  const path = `/en/${PAIRS[pair]}${kind === 'sentences' ? '-sentences' : ''}/${encodeURIComponent(q)}`;

  // Cloudflare has an edge cache API; elsewhere (Vercel) the CDN caches via the s-maxage header below.
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(`https://tureng-proxy.cache/${kind}/${pair}/${encodeURIComponent(q.toLowerCase())}`);
  const hit = cache ? await cache.match(cacheKey) : null;
  if (hit) {
    const res = new Response(hit.body, hit);
    Object.entries(cors.headers).forEach(([k, v]) => res.headers.set(k, v));
    res.headers.set('X-Cache', 'HIT');
    return res;
  }

  const upstream = await fetch(`https://tureng.com${path}`, {
    headers: {
      Accept: 'text/html',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'TurengMobileProxy/1.0 (personal PWA; +https://github.com/)',
    },
    redirect: 'follow',
  });
  const body = await upstream.text();
  const html = upstream.ok ? slim(body) : null;
  if (!html || html.length < 200) {
    // Typically a Cloudflare challenge page (403) from tureng.com: the app then falls back to Wiktionary.
    return json(502, { error: 'upstream_unavailable', status: upstream.status }, cors.headers);
  }

  const res = new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': `public, max-age=86400, s-maxage=${CACHE_SECONDS}` },
  });
  if (cache) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  Object.entries(cors.headers).forEach(([k, v]) => res.headers.set(k, v));
  res.headers.set('X-Cache', 'MISS');
  return res;
}
