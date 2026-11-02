// Pronunciation: Tureng's recorded MP3s when available, otherwise the device's speech synthesis (works offline on iOS).
//
// Recorded clips are played through Web Audio, not an <audio> element: iOS shows a "Now Playing" player on
// the lock screen for media elements (and keeps it there even after the clip is unloaded), but not for
// Web Audio sound effects. The MP3 bytes come through our proxy because Tureng's audio host sends no CORS headers.
import { LANGS } from './config.js';

// iOS audio session (Safari 17+). "playback" makes pronunciation audible even when the ring/silent switch is on;
// the default for Web Audio and the "transient"/"ambient" types are muted by the silent switch.
function setPlaybackSession() {
  try {
    if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback';
  } catch { /* not supported */ }
}
setPlaybackSession();

const AC = window.AudioContext || window.webkitAudioContext;

// Playback context. iOS suspends or "interrupts" it when the app is backgrounded or the phone is locked, and
// after that it may never resume. So it is replaced by a new one, created synchronously inside the next tap,
// whenever it is closed/interrupted, the page has been hidden, or it failed to start or its clock froze.
let ctx = null;
let needsNew = false;
let current = null;
const diag = { contexts: 0, plays: 0, lastError: '', lastErrorAt: 0 };

function noteError(e) {
  diag.lastError = String(e?.message || e);
  diag.lastErrorAt = Date.now();
  console.warn('[audio]', e);
}

/** For the Settings sheet: helps diagnose audio problems on a phone without dev tools. */
export function audioDiagnostics() {
  return {
    supported: !!AC,
    session: navigator.audioSession ? navigator.audioSession.type : 'n/a',
    state: ctx ? ctx.state : 'none',
    contexts: diag.contexts,
    plays: diag.plays,
    lastError: diag.lastError,
    lastErrorAgo: diag.lastErrorAt ? Math.round((Date.now() - diag.lastErrorAt) / 1000) : null,
  };
}

function newContext() {
  const old = ctx;
  if (old) old.close().catch(() => {});
  const c = new AC();
  diag.contexts++;
  // Playing a silent buffer inside the gesture unlocks output (needed on older iOS versions).
  try {
    const s = c.createBufferSource();
    s.buffer = c.createBuffer(1, 1, 22050);
    s.connect(c.destination);
    s.start(0);
  } catch { /* ignore */ }
  c.resume?.().catch(() => {});
  ctx = c;
  needsNew = false;
  current = null;
  return c;
}

/** Returns the playback context, creating/resuming it. Must be called synchronously inside a tap. */
function audioContext() {
  if (!AC) return null;
  if (!ctx || needsNew || ctx.state === 'closed' || ctx.state === 'interrupted') return newContext();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Coming back from the background is when iOS leaves the context broken: build a new one on the next tap.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') needsNew = true;
});
window.addEventListener('pagehide', () => { needsNew = true; });

function decode(ac, data) {
  // Callback form for older Safari, which doesn't return a promise.
  return new Promise((resolve, reject) => ac.decodeAudioData(data, resolve, reject));
}

// Raw MP3 bytes per URL (fetched ahead of time), decoded separately for each playback context:
// a re-created context decodes its own copy instead of reusing buffers from a dead one.
const rawBytes = new Map(); // url -> Promise<ArrayBuffer>
const decodedBy = new WeakMap(); // AudioContext -> Map(url -> Promise<AudioBuffer>)

function fetchBytes(url) {
  let p = rawBytes.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`audio_http_${r.status}`);
      return r.arrayBuffer();
    });
    rawBytes.set(url, p);
    p.catch(() => rawBytes.delete(url));
  }
  return p;
}

function loadBuffer(ac, url) {
  let perCtx = decodedBy.get(ac);
  if (!perCtx) decodedBy.set(ac, (perCtx = new Map()));
  let p = perCtx.get(url);
  if (!p) {
    p = fetchBytes(url).then((bytes) => decode(ac, bytes.slice(0))); // decodeAudioData detaches its input
    perCtx.set(url, p);
    p.catch(() => perCtx.delete(url));
  }
  return p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, msg) => Promise.race([p, sleep(ms).then(() => { throw new Error(msg); })]);

/** Waits for the context to actually run; iOS can take a while to spin up audio hardware. */
async function ensureRunning(ac, ms) {
  const until = Date.now() + ms;
  while (ac.state !== 'running') {
    if (Date.now() > until || ac.state === 'closed') throw new Error(`audio_not_running(${ac.state})`);
    ac.resume().catch(() => {});
    await sleep(60);
  }
}

function stopAll() {
  if (current) {
    try { current.stop(); } catch { /* already stopped */ }
    current = null;
  }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

/** Fetches and decodes clips ahead of time (no gesture needed), so taps play instantly. */
export function preloadAudio(urls) {
  if (!AC || !urls.length) return;
  urls.forEach((u) => {
    const p = fetchBytes(u);
    if (ctx && !needsNew) p.then(() => loadBuffer(ctx, u)).catch(() => {});
    else p.catch(() => {});
  });
}

export async function playUrl(url) {
  setPlaybackSession();
  const ac = audioContext(); // must stay before any await
  if (!ac) throw new Error('no_webaudio');
  stopAll();
  let buffer;
  try {
    [buffer] = await Promise.all([withTimeout(loadBuffer(ac, url), 5000, 'audio_timeout'), ensureRunning(ac, 2000)]);
  } catch (e) {
    if (ac === ctx && /not_running/.test(e.message)) needsNew = true;
    throw e;
  }
  const source = ac.createBufferSource();
  source.buffer = buffer;
  source.connect(ac.destination);
  source.onended = () => { if (current === source) current = null; };
  current = source;
  const t0 = ac.currentTime;
  source.start(0);
  diag.plays++;
  // Health check that never cuts the sound: if the clock didn't move, rebuild the context on the next tap.
  setTimeout(() => {
    if (ac === ctx && ac.currentTime === t0) {
      needsNew = true;
      noteError(new Error('audio_clock_frozen'));
    }
  }, 1200);
}

export const ttsSupported = () => 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

function pickVoice(tag) {
  const voices = speechSynthesis.getVoices();
  const norm = (s) => s.replace('_', '-').toLowerCase();
  const t = norm(tag);
  return (
    voices.find((v) => norm(v.lang) === t && v.localService) ||
    voices.find((v) => norm(v.lang) === t) ||
    voices.find((v) => norm(v.lang).startsWith(t.slice(0, 2)))
  );
}

/** Speaks `text`. `tag` is a BCP-47 locale (en-GB) or a 2-letter language code (falls back to its default locale). */
export function speak(text, tag) {
  if (!ttsSupported() || !text) return false;
  const locale = tag.length === 2 ? LANGS[tag]?.tts || tag : tag;
  stopAll();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = locale;
  const voice = pickVoice(locale);
  if (voice) u.voice = voice;
  u.rate = 0.9;
  speechSynthesis.speak(u);
  return true;
}

/** Plays a recorded clip (`url` = proxied MP3), falling back to TTS if it can't be played (offline, blocked, ...). */
export async function pronounce({ url, text, locale }) {
  if (url) {
    try {
      await playUrl(url);
      return;
    } catch (e) {
      noteError(e);
    }
  }
  speak(text, locale);
}

// Voices load asynchronously; touching the list early makes the first tap faster.
if (ttsSupported()) {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener?.('voiceschanged', () => speechSynthesis.getVoices());
}
