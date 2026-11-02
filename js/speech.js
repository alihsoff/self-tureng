// Pronunciation: Tureng's recorded MP3s when available, otherwise the device's speech synthesis (works offline on iOS).
//
// Recorded clips are played through Web Audio, not an <audio> element: iOS shows a "Now Playing" player on
// the lock screen for media elements (and keeps it there even after the clip is unloaded), but not for
// Web Audio sound effects. The MP3 bytes come through our proxy because Tureng's audio host sends no CORS headers.
import { LANGS } from './config.js';

// Short "transient" sounds (Safari 17+): duck the user's music briefly instead of stopping it.
try {
  if (navigator.audioSession) navigator.audioSession.type = 'transient';
} catch { /* not supported */ }

const AC = window.AudioContext || window.webkitAudioContext;
const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;

// Playback context. iOS suspends, "interrupts" or silently freezes it when the app is backgrounded, the phone
// is locked or after long idle periods, and resume() can then hang forever. So it is treated as disposable:
// dropped whenever the page is hidden or it stops running, and re-created synchronously inside the next tap.
let ctx = null;
let ctxUsable = false;
let current = null;
const buffers = new Map(); // url -> Promise<AudioBuffer>

// Decoding uses its own offline context: it never gets interrupted, needs no gesture, and the resulting
// AudioBuffers play in any later playback context.
let decoder = null;
function decodingContext() {
  if (!decoder && OAC) {
    try { decoder = new OAC(1, 1, 44100); } catch { decoder = null; }
  }
  return decoder || ctx;
}

function dropContext() {
  ctxUsable = false;
  const old = ctx;
  ctx = null;
  current = null;
  if (old) old.close().catch(() => {});
}

function newContext() {
  dropContext();
  const c = new AC();
  c.onstatechange = () => {
    if (c === ctx && (c.state === 'interrupted' || c.state === 'closed')) ctxUsable = false;
  };
  // Playing a silent buffer inside the gesture unlocks output (needed on older iOS versions).
  const s = c.createBufferSource();
  s.buffer = c.createBuffer(1, 1, 22050);
  s.connect(c.destination);
  s.start(0);
  if (c.state !== 'running') c.resume().catch(() => {});
  ctx = c;
  ctxUsable = true;
  return c;
}

/** Returns a running playback context. Must be called synchronously inside a tap. */
function audioContext() {
  if (!AC) return null;
  if (!ctx || !ctxUsable || ctx.state !== 'running') return newContext();
  return ctx;
}

// Backgrounding is when iOS breaks the context: release it and start fresh on the next tap.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') dropContext();
});
window.addEventListener('pagehide', dropContext);

function decode(ac, data) {
  // Callback form for older Safari, which doesn't return a promise.
  return new Promise((resolve, reject) => ac.decodeAudioData(data, resolve, reject));
}

function loadBuffer(url) {
  let p = buffers.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`audio_http_${r.status}`);
        return r.arrayBuffer();
      })
      .then((data) => {
        const dc = decodingContext();
        if (!dc) throw new Error('no_webaudio');
        return decode(dc, data);
      });
    buffers.set(url, p);
    p.catch(() => buffers.delete(url));
  }
  return p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, msg) => Promise.race([p, sleep(ms).then(() => { throw new Error(msg); })]);

function stopAll() {
  if (current) {
    try { current.stop(); } catch { /* already stopped */ }
    current = null;
  }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

/** Fetches and decodes clips ahead of time (no gesture needed), so the first tap plays instantly. */
export function preloadAudio(urls) {
  if (!AC || !urls.length) return;
  urls.forEach((u) => loadBuffer(u).catch(() => {}));
}

export async function playUrl(url) {
  const ac = audioContext(); // must stay before any await
  if (!ac) throw new Error('no_webaudio');
  stopAll();
  const buffer = await withTimeout(loadBuffer(url), 4000, 'audio_timeout');
  if (ac !== ctx) throw new Error('audio_context_replaced'); // page was hidden meanwhile
  const source = ac.createBufferSource();
  source.buffer = buffer;
  source.connect(ac.destination);
  source.onended = () => { if (current === source) current = null; };
  current = source;
  const t0 = ac.currentTime;
  source.start(0);
  // Watchdog: a context can claim to be "running" while frozen. If its clock doesn't move, discard it
  // (the next tap builds a new one) and let the caller fall back to speech synthesis this time.
  await sleep(250);
  if (ac.currentTime === t0 || ac.state !== 'running') {
    try { source.stop(); } catch { /* ignore */ }
    if (ac === ctx) ctxUsable = false;
    throw new Error('audio_stalled');
  }
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
      console.warn('[audio]', e);
    }
  }
  speak(text, locale);
}

// Voices load asynchronously; touching the list early makes the first tap faster.
if (ttsSupported()) {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener?.('voiceschanged', () => speechSynthesis.getVoices());
}
