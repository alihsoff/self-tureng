// Minimal CORS proxy for Tureng Mobile, shared by every deploy target:
// Cloudflare Worker (worker/src/site.js, worker/src/index.js), Cloudflare Pages (functions/proxy.js), Vercel (api/proxy.js).
// GET ?pair=entr&q=hello  ->  results column of https://tureng.com/en/turkish-english/hello as HTML.
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

export async function handleProxy(request, env = {}, ctx = { waitUntil() {} }) {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors.headers });
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' }, cors.headers);
  if (!cors.allowed) return json(403, { error: 'origin_not_allowed' }, cors.headers);

  const url = new URL(request.url);
  const pair = url.searchParams.get('pair') || 'entr';
  const q = (url.searchParams.get('q') || '').trim();
  if (!PAIRS[pair] || !q || q.length > 120) return json(400, { error: 'bad_request' }, cors.headers);

  // Cloudflare has an edge cache API; elsewhere (Vercel) the CDN caches via the s-maxage header below.
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(`https://tureng-proxy.cache/${pair}/${encodeURIComponent(q.toLowerCase())}`);
  const hit = cache ? await cache.match(cacheKey) : null;
  if (hit) {
    const res = new Response(hit.body, hit);
    Object.entries(cors.headers).forEach(([k, v]) => res.headers.set(k, v));
    res.headers.set('X-Cache', 'HIT');
    return res;
  }

  const upstream = await fetch(`https://tureng.com/en/${PAIRS[pair]}/${encodeURIComponent(q)}`, {
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
