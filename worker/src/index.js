// Standalone Cloudflare Worker entry (use this when the app is hosted on GitHub Pages).
import { handleProxy } from './proxy.js';

export default {
  fetch: (request, env, ctx) => handleProxy(request, env, ctx),
};
