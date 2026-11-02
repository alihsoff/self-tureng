// Cloudflare Pages Function: serves the proxy at /proxy on the same domain as the app (no CORS setup needed).
import { handleProxy } from '../worker/src/proxy.js';

export const onRequest = (context) => handleProxy(context.request, context.env, context);
