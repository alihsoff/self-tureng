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

let ctx = null;
let current = null;
const buffers = new Map(); // url -> Promise<AudioBuffer>

/** Creates/resumes the AudioContext. Call synchronously inside a tap so iOS unlocks audio. */
function audioContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    ctx = new AC();
    // Playing a silent buffer inside the first gesture unlocks output on older iOS versions.
    const silent = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = silent;
    s.connect(ctx.destination);
    s.start(0);
  }
  if (ctx.state === 'suspended' || ctx.state === 'interrupted') ctx.resume().catch(() => {});
  return ctx;
}

function decode(ac, data) {
  // Callback form for older Safari, which doesn't return a promise.
  return new Promise((resolve, reject) => ac.decodeAudioData(data, resolve, reject));
}

function loadBuffer(ac, url) {
  let p = buffers.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`audio_http_${r.status}`);
        return r.arrayBuffer();
      })
      .then((data) => decode(ac, data));
    buffers.set(url, p);
    p.catch(() => buffers.delete(url));
  }
  return p;
}

function stopAll() {
  if (current) {
    try { current.stop(); } catch { /* already stopped */ }
    current = null;
  }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

/** Fetches and decodes clips ahead of time (no gesture needed), so the first tap plays instantly. */
export function preloadAudio(urls) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || !urls.length) return;
  if (!ctx) {
    try { ctx = new AC(); } catch { return; } // starts suspended; resumed on the first tap
  }
  urls.forEach((u) => loadBuffer(ctx, u).catch(() => {}));
}

export async function playUrl(url) {
  const ac = audioContext(); // must stay before any await
  if (!ac) throw new Error('no_webaudio');
  stopAll();
  const buffer = await loadBuffer(ac, url);
  if (ac.state !== 'running') await ac.resume();
  const source = ac.createBufferSource();
  source.buffer = buffer;
  source.connect(ac.destination);
  source.onended = () => { if (current === source) current = null; };
  current = source;
  source.start(0);
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
