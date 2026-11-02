// Vercel serverless function. vercel.json rewrites /proxy -> /api/proxy so the app finds it on the same domain.
import { handleProxy } from '../worker/src/proxy.js';

export const GET = (request) => handleProxy(request, process.env);
export const OPTIONS = (request) => handleProxy(request, process.env);
