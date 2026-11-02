// Per-device persistence (localStorage). Every access is guarded: private mode / quota errors must never break the app.

const KEYS = { settings: 'tm.settings.v1', history: 'tm.history.v1', favorites: 'tm.favorites.v1', cache: 'tm.cache.v1' };
const HISTORY_MAX = 60;
const CACHE_MAX = 40;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ---- settings
const DEFAULT_SETTINGS = { proxyUrl: null, pair: 'entr', accent: 'en-US', theme: 'auto' };
export const settings = {
  get() {
    return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
  },
  set(patch) {
    const next = { ...this.get(), ...patch };
    write(KEYS.settings, next);
    return next;
  },
};

// ---- history & favorites: [{ q, pair, t }]
const sameEntry = (a, q, pair) => a.pair === pair && a.q.toLowerCase() === q.toLowerCase();

export const history = {
  list: () => read(KEYS.history, []),
  add(q, pair) {
    const list = this.list().filter((x) => !sameEntry(x, q, pair));
    list.unshift({ q, pair, t: Date.now() });
    write(KEYS.history, list.slice(0, HISTORY_MAX));
  },
  remove(q, pair) {
    write(KEYS.history, this.list().filter((x) => !sameEntry(x, q, pair)));
  },
  clear: () => write(KEYS.history, []),
};

export const favorites = {
  list: () => read(KEYS.favorites, []),
  has(q, pair) {
    return this.list().some((x) => sameEntry(x, q, pair));
  },
  toggle(q, pair, preview = '') {
    const list = this.list();
    const on = !list.some((x) => sameEntry(x, q, pair));
    write(KEYS.favorites, on ? [{ q, pair, preview, t: Date.now() }, ...list] : list.filter((x) => !sameEntry(x, q, pair)));
    return on;
  },
};

// ---- lookup cache (LRU, Tureng results only) so revisited words work instantly and offline
export const cache = {
  key: (q, pair) => `${pair}:${q.trim().toLowerCase()}`,
  get(q, pair) {
    const all = read(KEYS.cache, {});
    return all[this.key(q, pair)]?.v || null;
  },
  set(q, pair, value) {
    const all = read(KEYS.cache, {});
    all[this.key(q, pair)] = { v: value, t: Date.now() };
    let entries = Object.entries(all).sort((a, b) => b[1].t - a[1].t).slice(0, CACHE_MAX);
    // On quota errors drop the oldest half and retry once.
    if (!write(KEYS.cache, Object.fromEntries(entries))) {
      entries = entries.slice(0, Math.max(1, Math.floor(entries.length / 2)));
      write(KEYS.cache, Object.fromEntries(entries));
    }
  },
  clear: () => write(KEYS.cache, {}),
};
