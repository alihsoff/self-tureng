// Central configuration. Edit DEFAULT_PROXY_URL after deploying the worker (see README).

export const APP_VERSION = '1.0.0';

// Proxy resolution (see api.js):
//  1. URL saved in the in-app Settings sheet (per device), else
//  2. DEFAULT_PROXY_URL below, e.g. 'https://tureng-proxy.<you>.workers.dev/' (needed on GitHub Pages), else
//  3. SAME_ORIGIN_PROXY: the Cloudflare Pages Function (functions/proxy.js) or the local dev server mock.
export const DEFAULT_PROXY_URL = '';
export const SAME_ORIGIN_PROXY = 'proxy';

export const TURENG_WEB = 'https://tureng.com';
export const AUTOCOMPLETE_URL = 'https://ac.tureng.co/';
export const WIKTIONARY_API = 'https://en.wiktionary.org/w/api.php';

// Tureng dictionaries. `foreign` = the side the row speaker pronounces by default.
export const PAIRS = {
  entr: { code: 'entr', label: 'EN ⇄ TR', slug: 'turkish-english', langs: ['en', 'tr'], foreign: 'en' },
  ende: { code: 'ende', label: 'EN ⇄ DE', slug: 'german-english', langs: ['en', 'de'], foreign: 'de' },
  enfr: { code: 'enfr', label: 'EN ⇄ FR', slug: 'french-english', langs: ['en', 'fr'], foreign: 'fr' },
  enes: { code: 'enes', label: 'EN ⇄ ES', slug: 'spanish-english', langs: ['en', 'es'], foreign: 'es' },
};
export const DEFAULT_PAIR = 'entr';

export const LANGS = {
  en: { name: 'English', short: 'EN', tts: 'en-US' },
  tr: { name: 'Turkish', short: 'TR', tts: 'tr-TR' },
  de: { name: 'German', short: 'DE', tts: 'de-DE' },
  fr: { name: 'French', short: 'FR', tts: 'fr-FR' },
  es: { name: 'Spanish', short: 'ES', tts: 'es-ES' },
};

// Accent labels for Tureng audio files (files/<locale>/...mp3) and TTS buttons.
export const ACCENTS = {
  'en-US': { flag: '🇺🇸', label: 'US' },
  'en-GB': { flag: '🇬🇧', label: 'UK' },
  'en-AU': { flag: '🇦🇺', label: 'AU' },
  'fr-FR': { flag: '🇫🇷', label: 'FR' },
  'fr-CA': { flag: '🇨🇦', label: 'CA' },
  'es-ES': { flag: '🇪🇸', label: 'ES' },
  'es-MX': { flag: '🇲🇽', label: 'MX' },
  'de-DE': { flag: '🇩🇪', label: 'DE' },
  'tr-TR': { flag: '🇹🇷', label: 'TR' },
};

export function pairUrl(pair, term) {
  return `${TURENG_WEB}/en/${PAIRS[pair].slug}/${encodeURIComponent(term)}`;
}
