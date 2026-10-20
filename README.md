# 📖 → 🔊 Manuscript Reader

Turn a manuscript into natural-sounding audio you can **listen to and download**.
Paste text or drop in a `.txt`, `.md`, `.docx`, or `.pdf`, pick a voice, and get an
audio file back — one chapter or a whole book.

- **Premium AI voices** via **OpenAI** and/or **ElevenLabs** (whichever key you add).
- **Handles long manuscripts** — automatically splits the text, shows progress, and
  stitches everything into a single audio file.
- **Listen in the browser** and **download the audio** to keep (e.g. on your phone).
- **Free Demo mode** — runs with no API key at all, so you can try the whole thing first.

---

## Quick start

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm start
```

Then open **http://localhost:3000**.

That's it — it works immediately in **Demo mode** (a placeholder voice, no key needed).
To get real, natural voices, add an API key (next section).

## Turning on real voices

1. Copy the example config:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and paste in a key for **one** provider (you don't need both):

   | Provider       | Where to get a key                                  | Notes |
   | -------------- | --------------------------------------------------- | ----- |
   | **OpenAI**     | https://platform.openai.com/api-keys                | Great value, very natural. ~\$12–30 per **million** characters. |
   | **ElevenLabs** | https://elevenlabs.io/app/settings/api-keys         | The most human / audiobook-grade. Uses your ElevenLabs credits. |

3. Restart the app (`npm start`). The new provider appears in the **Voice** menu.

> Your key stays on your machine in `.env` (which is git-ignored) and is only used
> server-side to talk to the provider. Your manuscript text is sent **only** to the
> provider you pick — and in Demo mode it never leaves your computer.

## 📱 Put it on your phone (deploy it online)

Running `npm start` only works on the computer you run it on. To use it from your
phone anywhere, host it online. The easiest free option is **[Render](https://render.com)**,
and your code is already on GitHub, so it's mostly clicking.

> **Read this first — security:** once the app is on the public internet with your
> API key, *anyone who finds the URL could run up your bill*. So you set a
> **passcode** during deploy (`APP_PASSCODE`). The app is useless to anyone who
> doesn't know it. Use a **long, unique passphrase** (not a common word) — the
> server rate-limits wrong guesses, but a strong passphrase is your real
> protection. You can generate one with `openssl rand -base64 24`.

### Deploy on Render (free)

1. Go to **[render.com](https://render.com)** and sign up (you can use your GitHub account).
2. Click **New → Blueprint**, then connect this repository (`Manuscript-reader-app`).
   Render reads `render.yaml` and sets everything up.
3. It will ask you for a few values (none of these are stored in your code):
   - **`APP_PASSCODE`** — a long, unique passphrase of your choosing (not a common
     word). You'll type this once on your phone to unlock the app.
   - **`OPENAI_API_KEY`** *or* **`ELEVENLABS_API_KEY`** — your voice key, for real
     narration. (You can skip this and it'll run in Demo mode, then add the key
     later in the Render dashboard.)
4. Click **Apply / Deploy** and wait a couple of minutes. Render gives you a URL
   like `https://manuscript-reader-xxxx.onrender.com`.
5. On your phone, open that URL, enter your passcode, and you're in. In Safari/Chrome
   choose **“Add to Home Screen”** to get an app icon that opens full-screen.

> On Render's free plan the app “sleeps” after ~15 minutes of no use and takes
> ~30–60 seconds to wake up on the next visit. That's normal for free hosting.
> The generated audio is also stored only on that temporary server, so **download
> any recording you want to keep before leaving the app idle** — when the service
> sleeps, undownloaded audio is discarded and you'd need to generate it again.

### Other hosts

A `Dockerfile` is included (it bundles **ffmpeg** for gapless audio stitching), so
you can also deploy to **Fly.io**, **Google Cloud Run**, **Railway**, or any VPS.
Set the same environment variables (`APP_PASSCODE`, and a voice key). Render's native
path above doesn't need Docker — the app just skips ffmpeg and concatenates audio
directly, which still plays fine.

## How to use it

1. **Paste** your manuscript, or **upload** a file.
2. Pick a **provider**, **voice**, **model/quality**, and **speed**.
3. Check the **estimate** (words, characters, rough cost).
4. Click **Create audio**, watch the progress, then **play** and **download**.

## A few notes

- **Cost**: long books can be many hundreds of thousands of characters. The estimate
  shown before you generate is a guide — always check your provider's dashboard for
  real usage. Try a chapter first.
- **Audio stitching**: if [ffmpeg](https://ffmpeg.org) is installed, parts are joined
  cleanly and gaplessly. Without it, they're concatenated directly (still plays fine
  in browsers and most players).
- **Formats in**: `.txt`, `.md`, `.docx`, `.pdf`. Old `.doc` isn't supported — re-save
  as `.docx` or `.pdf`.
- **Formats out**: MP3 for OpenAI/ElevenLabs, WAV for the Demo voice.

## Project layout

```
server/
  index.js          Express API + static hosting
  tts/              Voice providers (openai, elevenlabs, demo) + dispatch
  lib/
    extract.js      Text extraction from txt/docx/pdf
    chunk.js        Splits long text on natural boundaries
    audio.js        Stitches audio chunks (ffmpeg when available)
    jobs.js         Background generation + progress tracking
public/             The web UI (index.html, styles.css, app.js)
```

## Troubleshooting

- **"running in Demo mode"** on startup → no key was found. Make sure `.env` exists
  (not just `.env.example`) and the key line has no quotes or spaces.
- **A provider is missing from the menu** → its key isn't set, or the app wasn't
  restarted after editing `.env`.
- **PDF came out messy** → PDFs vary a lot. Review the extracted text in the box and
  tidy it before generating, or export your document as `.docx`/`.txt` instead.
