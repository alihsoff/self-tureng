// Pronunciation: Tureng's recorded MP3s when available, otherwise the device's speech synthesis (works offline on iOS).
import { LANGS } from './config.js';

let audioEl = null;

export function playUrl(src) {
  // A single reused element: iOS only allows playback started from a user gesture, and reuse keeps that "unlocked".
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = 'auto';
  }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  audioEl.pause();
  audioEl.src = src;
  return audioEl.play();
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
  if (audioEl) audioEl.pause();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = locale;
  const voice = pickVoice(locale);
  if (voice) u.voice = voice;
  u.rate = 0.9;
  speechSynthesis.speak(u);
  return true;
}

/** Plays a recorded file, falling back to TTS if the file can't be played (offline, blocked, ...). */
export async function pronounce({ src, text, locale }) {
  if (src) {
    try {
      await playUrl(src);
      return;
    } catch {
      /* fall through to TTS */
    }
  }
  speak(text, locale);
}

// Voices load asynchronously; touching the list early makes the first tap faster.
if (ttsSupported()) {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener?.('voiceschanged', () => speechSynthesis.getVoices());
}
