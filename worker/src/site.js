// Cloudflare Workers entry for the whole app (root wrangler.jsonc): static files + /proxy on one domain.
// Static assets are matched first; only requests without a matching file (like /proxy) reach this code.
import { handleProxy } from './proxy.js';

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/proxy' || pathname.endsWith('/proxy')) return handleProxy(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
};
