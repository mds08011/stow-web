# Stow Web

A web port of [Stow](https://github.com/mds08011/stow), the Android BYOK dictation app. Record a voice note, get it transcribed by Groq Whisper, then polished by a Groq LLM using a prompt preset you control.

Single static page. No build step, no framework, no backend, no analytics, no third-party requests, no service worker. Everything except the two Groq API calls happens in your browser, and everything you save stays in `localStorage` on the device that saved it.

Built for Safari on iPadOS and iOS, added to the home screen. It works in any modern browser, but that is the target.

## What it does

1. **Record** — one big button, elapsed timer, screen wake lock held for the duration.
2. **Transcribe** — `whisper-large-v3-turbo` on Groq, biased with your jargon dictionary so it hears project names and trade terms correctly.
3. **Polish** — `llama-3.1-8b-instant` on Groq, driven by the polish preset selected next to the record button.
4. **Read it** — polished Markdown in a readable view, with Copy, Share, and a toggle to see the raw transcript Whisper actually produced.
5. **Keep it** — the last 50 sessions live in `localStorage` with per-item delete and clear-all.

## Setup

### Host it on GitHub Pages

1. Push this folder to a GitHub repo (`index.html` must be at the repo root, or in `/docs`).
2. On GitHub: **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Pick the branch (`main`) and the folder (`/ (root)`, or `/docs` if that is where `index.html` lives). **Save**.
5. Wait for the green check on the Pages deployment, then open `https://<user>.github.io/<repo>/`.

This is the same setup [splice](https://github.com/mds08011/splice) already uses (`main`, `/` root, serving `mds08011.github.io/splice/`).

HTTPS is not optional — Safari refuses microphone access on anything but a secure origin, so Pages is doing real work here, not just hosting. Note that Pages on a *private* repo requires GitHub Pro or higher; on a public repo it is free.

### Add your API key

Get a key at [console.groq.com](https://console.groq.com/keys), then open **Settings** in the app and paste it. It is written to `localStorage` on that device and sent only in the `Authorization` header of requests to `api.groq.com`. Nothing else ever sees it. The settings screen shows it masked, with **Test** and **Clear** buttons.

**Test** verifies the key against Groq's `/models` endpoint so you find out immediately, rather than after recording something and getting a 401. It checks whatever is in the entry field when you are typing a new key, and the stored key otherwise.

Because the key lives in browser storage on a page anyone can view-source, treat it as a personal-device key. Rotate it if the device is lost.

### Add to home screen on iPad / iPhone

1. Open the Pages URL in **Safari** (not Chrome — on iOS, only Safari can install a real home-screen web app).
2. Tap the **Share** button (square with an up arrow).
3. Scroll down and tap **Add to Home Screen**.
4. Name it (it will suggest "Stow") and tap **Add**.

Launching from the home-screen icon opens it standalone, without Safari's chrome. Note that a home-screen app has its own storage bucket — your API key, jargon, presets, and history do **not** carry over from the Safari tab you installed it from. Re-enter the key once inside the installed app.

The first recording will ask for microphone permission. If you ever tap Don't Allow, fix it at **Settings → Safari → Microphone**, or in Safari via **aA → Website Settings → Microphone → Allow**.

## The screen has to stay on

This is the one real limitation versus the Android app, and it is not fixable in a web page.

Android Stow records in a foreground service, so it keeps capturing with the screen off and the app in the background. A web page cannot do that. Browsers suspend media capture when the page is hidden.

So while Stow Web is recording:

- **Keep the screen on.** The app takes a `navigator.wakeLock` screen lock, which stops the display from dimming and sleeping on its own. It cannot stop you pressing the power button.
- **Keep the app in the foreground.** Switching to another app, or backgrounding the home-screen app, stops the capture.
- Locking the device or switching apps mid-recording will cut the take short or lose it.

For dictation-length captures — seconds to a few minutes — this is a non-issue in practice. It rules out leaving it running through a meeting.

## Settings

**Jargon dictionary** — comma-separated terms. Used twice: appended to Whisper's biasing prompt so the transcription hears them, and given to the polish model so it preserves them. This is the same mechanism as the Android app.

Whisper only honours roughly the last 224 tokens of its prompt, so keep the list to the terms that actually get misheard. A dictionary of hundreds of entries will push the useful ones out of scope.

**Polish presets** — named `{name, prompt}` pairs. The prompt becomes the system message; the raw transcript is sent as the user message. Two ship by default, copied verbatim from Android Stow:

- **Clean prose** — light cleanup. Strips fillers, fixes grammar and punctuation, keeps your voice and roughly your length, adds nothing.
- **Task capture** — restructures the note. Spoken action items become `- [ ]` checkbox lines grouped under `## <job>`, `## Personal`, or `## Unsorted`; everything else stays as prose under `## Notes`.

Both built-ins can be renamed and edited, and reset to their shipped text. They cannot be deleted. Custom presets can be deleted.

The jargon dictionary is appended to any preset automatically. If you want control over where it lands, put `{{JARGON_LIST}}` in the prompt and it will be substituted there instead.

The preset selector sits next to the record button and remembers your last choice.

### Keeping the built-in prompts in sync

The two built-in prompts are duplicated here and in Android Stow's `PolishPresets.kt`. Since both apps use the same preset names, a divergence would be silent — nothing breaks, the same preset just quietly stops producing the same output on the phone and the iPad.

`.github/check-prompt-drift.js` guards against that. It fetches `PolishPresets.kt` from `mds08011/stow` and fails if either prompt no longer matches byte for byte, naming the first differing line. CI runs it on every push that touches `index.html`, on pull requests, and weekly — the schedule matters most, because drift is far more likely to be introduced on the Android side, where nothing in this repo would otherwise run.

Run it yourself against the live source, or against a local checkout:

```bash
node .github/check-prompt-drift.js
```

```bash
node .github/check-prompt-drift.js ../stow
```

If you deliberately revise a prompt, change it in both repos.

## When a Groq call fails

Your recording is never thrown away by a failure. The error banner gives you the options:

- **Retry** — re-runs only the stage that failed. A failed polish does not re-upload or re-transcribe the audio.
- **Keep raw transcript** — shown when transcription succeeded but polish did not. Saves the session with the raw text only.
- **Discard** — throws the recording away, deliberately.

Starting a new recording while an unsaved one is parked will ask before discarding it.

Errors are translated rather than dumped: a 401 says the key was rejected, a 429 says rate limit, a 413 says the file exceeds Groq's 25 MB limit, and a dropped connection says you are offline.

**Rate limits tell you how long.** Groq reports the wait two ways and neither is reliable alone — a `retry-after` header, and prose in the error body (`try again in 2m59.56s`). Stow Web takes whichever is larger and counts the Retry button down, keeping it disabled until a retry could actually succeed, because retrying early just burns another slot. It does not fire on its own: a session holding unsaved audio should not act without being asked.

**The recording outlives the tab.** The audio blob is written to IndexedDB as soon as recording stops — before the first upload, not after it fails — and again once a transcript comes back. If the tab is reloaded, crashes, or is evicted by iPadOS while a session is unfinished, the next launch offers it back with **Transcribe it** / **Polish it** and **Discard**. Resuming picks up from the furthest stage reached, so a crash after transcription does not pay for the same transcription twice. The record is deleted once the session is saved or discarded.

This matters specifically on the primary target: iPadOS evicts backgrounded Safari tabs aggressively, and an in-memory-only blob would make the Retry button a promise the app could not keep. If IndexedDB is unavailable (private browsing, blocked storage) everything still works — an unfinished recording just does not survive the tab.

## Daily usage meter

A thin bar under the record screen shows how much audio you have sent to Groq today against the free tier's 8 hours per day — the same metric Android Stow shows, worded the same way, so the two can be read interchangeably: `Today's usage: 12m (2% of 8h Groq free limit)`. The bar turns red past 80%. If you somehow exceed the limit the bar stays full but the text keeps counting honestly (`112%`).

Two things it does not claim to be:

- **It counts this device only.** The tally lives in this browser's `localStorage`, so an iPad and a phone using the same key each see their own number. Groq's console is the authoritative figure.
- **It counts successful transcriptions only.** A call that failed and was retried is counted once, when it succeeded. Resuming a restored recording that was already transcribed does not count again, because it does not re-transcribe.

The counter resets at local midnight. There is no timer doing that — the stored date is compared against today's on every read, so a stale total simply reads as zero.

## Storage

Settings and history are `localStorage`; an unfinished recording's audio is IndexedDB (`stow` → `pending`), since `localStorage` cannot hold a Blob.

| Key | Contents |
|---|---|
| `stow_groq_key` | Your Groq API key |
| `stow_jargon` | Jargon dictionary |
| `stow_presets` | JSON array of `{id, name, prompt}` |
| `stow_selected_preset` | Last-used preset id |
| `stow_history` | JSON array of sessions, newest first |
| `stow_usage` | `{date, sec}` — today's audio seconds sent to Groq |

History is capped so it can never overflow the quota: 50 sessions maximum, 400 KB serialized maximum, and 20,000 characters per stored text. Whichever binds first wins, oldest dropped. If a write is rejected anyway, the list is halved until it fits.

Clearing Safari's website data wipes all of it, including your key. There is no sync and no export in v1.

## Left out of v1

Deliberately not ported from Android Stow:

- **Background recording** — impossible in a web page. See above.
- **Persistent notification with a Stop action** — same reason.
- **Auto-copy on transcribe** — iOS only allows clipboard writes from a user gesture, so copying is a tap on the Copy button instead of automatic.
- **Legacy `Stow_Log.txt` migration** — nothing to migrate on a fresh install.
- **Editing the result text in place** and saving edits back to history — read-only view in v1.
- **Re-polish a history entry with a different preset** — you can copy the raw transcript out, but there is no in-app re-run.
- **Search across history**.
- **Export all sessions as one text blob**.
- **Offline support** — no service worker in v1 by design, and the app is useless offline anyway since both stages are API calls.

## Browser notes

Recording needs `getUserMedia` and `MediaRecorder` on a secure origin. That means **https or `localhost`** — opening `index.html` as a `file://` URL will render the whole UI fine, but the microphone is blocked by the browser and the app will say so.

Audio format is negotiated at record time: Chrome and Firefox produce WebM/Opus, Safari produces MP4/AAC. Groq accepts all of them.

Requires iOS/iPadOS 14.3 or later for `MediaRecorder`. The wake lock needs iOS 16.4 or later; on older versions everything else still works, the screen just dims on its normal schedule.
