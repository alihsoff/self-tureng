# Self Tureng

An ad-free, mobile-first web app (PWA) for the [Tureng](https://tureng.com) dictionary. It is built to be added to the iPhone home screen and run like a native app.

- **Dictionaries:** EN⇄TR, EN⇄DE, EN⇄FR, EN⇄ES
- **Autocomplete:** uses Tureng's public suggestion API
- **Pronunciation:**
  - Tureng's recorded audio (🇺🇸 US / 🇬🇧 UK / 🇦🇺 AU, 🇫🇷 FR / 🇨🇦 CA, 🇪🇸 ES / 🇲🇽 MX)
  - the device's text-to-speech for every other word (works offline on iOS)
- **No ads:** the app only extracts the dictionary data. Tureng's scripts, ads and trackers are never loaded.
- **Example sentences (EN⇄TR):** examples under each meaning, with a speaker for the English sentence. A switch hides them. **More example sentences** loads Tureng's full list.
- **Saved data:** favorites, search history and an offline cache of looked-up words
- **Settings:** light/dark/auto theme and preferred English accent
- **Fallback:** if Tureng can't be reached, results come from Wiktionary

No build step: plain HTML/CSS/ES modules, so it can be hosted as-is on GitHub Pages.

## How data is loaded

```
iPhone (PWA on GitHub Pages)
  ├─ autocomplete ──────────────► ac.tureng.co            (public, CORS-enabled)
  ├─ pronunciation ─────────────► voicesr2.tureng.com/*.mp3
  ├─ lookup ──► /proxy (Pages Function) or Worker ──► tureng.com   (cached 7 days)
  └─ fallback ──────────────────► en.wiktionary.org API     (CORS-enabled)
```

A browser page on `github.io` can't read `tureng.com` directly, because Tureng sends no CORS headers. The small worker in `worker/` forwards only the four dictionary pages. It strips scripts and ads, adds CORS headers and caches the results.

> ⚠️ **Note:** tureng.com sits behind Cloudflare bot protection. Plain HTTP clients like `curl` get a 403 "Just a moment…" page, and the worker may get one too. If that happens, the app shows a banner and uses Wiktionary results instead. Autocomplete and Tureng audio keep working. The worker does not try to get around that protection. Use it for personal use only and respect Tureng's terms.

## Run locally

```bash
npm run dev          # http://localhost:5173
HOST=0.0.0.0 npm run dev   # reachable from a phone on the same Wi-Fi
```

Locally, `/proxy` is a mock backed by `dev/fixtures/<pair>/<term>.html`. Fixtures exist for `hello`, `merhaba`, `helllo` (suggestions) and FR `maison`. Any other word returns 502, which shows the Wiktionary fallback.

## Deploy

### Option A — Cloudflare Workers (recommended: app + proxy on one domain, free)

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com).
2. Open **Workers & Pages → Create → Import a repository** and pick this repository.
3. Fill in the settings:
   - **Project name:** `self-tureng`. It must match `name` in `wrangler.jsonc`.
   - **Build command:** *(leave empty)*
   - **Deploy command:** `npx wrangler deploy`
4. Click **Deploy**. The app runs at `https://self-tureng.<account>.workers.dev`.

`wrangler.jsonc` publishes the static files and routes `/proxy` to `worker/src/proxy.js`. `.assetsignore` keeps repository-only files from being published. Every `git push` to `main` redeploys.

Using Cloudflare **Pages** instead also works:
- Framework preset: None
- Build command: *(leave empty)*
- Output directory: `/`

In that case `functions/proxy.js` serves `/proxy`.

### Option C — Vercel (static app; proxy via the Cloudflare Worker)

1. Import the repository.
2. Choose the **Other** preset with root directory `./`, and leave the build settings at their defaults.
3. Deploy.

`vercel.json` rewrites `/proxy` on the server side to the Cloudflare Worker from Option A. Phones only ever talk to `vercel.app`. This matters because some ISPs (reported in Turkey) block `*.workers.dev`.

Tureng blocks proxies that run on Node.js, so a Vercel-hosted proxy is not used.

### Option B — GitHub Pages + a separate Worker

1. **Deploy the proxy:**

   ```bash
   cd worker
   npx wrangler login
   npx wrangler deploy      # prints https://tureng-proxy.<account>.workers.dev
   ```

2. **Give the app the worker URL.** Either:
   - set `DEFAULT_PROXY_URL` in `js/config.js`, or
   - paste it into the app under **Settings → Tureng proxy URL** and tap **Test**.

3. **Lock the worker to your site.** In `worker/wrangler.toml`, set:

   ```toml
   ALLOWED_ORIGINS = "https://<user>.github.io"
   ```

4. **Turn on GitHub Pages.** In the repository go to **Settings → Pages → Deploy from branch**, and pick `main` with the `/ (root)` folder. The app runs at `https://<user>.github.io/<repo>/`.

When you change any file the service worker caches, bump `VERSION` in `sw.js` so installed copies update.

### Add to the iPhone home screen

Open the URL in Safari, tap **Share → Add to Home Screen**. It then opens full-screen and has its own icon.

## Project structure

```
index.html              App shell + iOS/PWA meta tags
css/app.css             Styles (light/dark, safe areas, mobile layout)
js/app.js               UI: routing (#/<pair>/<term>), search, results, sheets, settings
js/api.js               Data layer: cache → Tureng (proxy) → Wiktionary
js/tureng.js            Tureng HTML parser (DOMParser; inert, no scripts/ads)
js/wiktionary.js        Wiktionary fallback (translations + definitions + IPA)
js/speech.js            Audio playback + speech synthesis
js/store.js             localStorage: settings, history, favorites, LRU cache
js/config.js            Dictionaries, URLs, proxy URL
sw.js                   Service worker (offline app shell)
manifest.webmanifest    PWA manifest
icons/                  App icons (regenerate with `npm run icons`)
wrangler.jsonc          Cloudflare Workers deploy config (static assets + /proxy)
worker/                 Proxy logic (src/proxy.js), site entry (src/site.js), standalone Worker
functions/proxy.js      Same proxy as a Cloudflare Pages Function (/proxy)
vercel.json             Vercel: rewrites /proxy to the Cloudflare Worker
dev/                    Local dev server, fixtures, icon generator
```

`?q=word&pair=entr` opens a lookup directly. This is handy for iOS Shortcuts.
