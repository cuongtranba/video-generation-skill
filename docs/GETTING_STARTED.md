# Getting Started with vidgen

From zero to a ready-to-post 9:16 Vietnamese-voiced short video, step by step — entirely in your browser.

This guide takes you from install through your **first rendered video** and out to publishing. Every step is persisted as events in NATS JetStream, so you can stop at any point and resume — nothing is lost.

---

## 1. Prerequisites

vidgen runs as a set of Docker containers. You only need:

| Tool | Why | Install |
|---|---|---|
| **Docker** | runs all services (nats, postgres, api, worker, frontend) | [docs.docker.com](https://docs.docker.com/get-docker/) |

No Go, Homebrew, Whisper, or claude CLI install is needed on the host — everything runs inside the containers.

---

## 2. Clone and configure

```bash
git clone https://github.com/cuongtranba/video-generation-skill
cd video-generation-skill
cp .env.example .env
```

Edit `.env` and fill in your API keys:

```env
FPT_TTS_API_KEY=...      # console.fpt.ai        — Vietnamese TTS (required)
PEXELS_API_KEY=...       # pexels.com/api        — stock video (free, required)
PIXABAY_API_KEY=...      # optional              — image fallback
JAMENDO_CLIENT_ID=...    # devportal.jamendo.com — background music (free, required)
TIKTOK_ACCESS_TOKEN=...  # developers.tiktok.com — only for publish step
COST_CAP_USD=0.15        # hard cost ceiling per video (default 0.15)
```

`.env` is gitignored. Real environment variables take precedence over the file.

---

## 3. Start the stack

```bash
docker compose up --build
```

This starts five services: `nats`, `postgres`, `api`, `worker`, and `frontend`. When all services are healthy, open [http://localhost:3000](http://localhost:3000).

---

## 4. Make your first video

The browser flow is **7 steps**: New Project → script → material → voiceovers → approve → render → download/publish.

### Step 1 — New Project

Click **New Project** and enter:
- Your idea (e.g. `3 lý do bạn nên uống nước ấm mỗi sáng`)
- Duration in seconds (e.g. 30)
- Number of scenes (e.g. 3)

### Step 2 — Script

The Anthropic Agent SDK generates a scene-by-scene Vietnamese script (narration + visual notes). Script generation costs `$0` (`scriptUsd = 0` always).

Note the **project ID** shown in the URL — you can return to this project at any time.

### Step 3 — Material

The app fetches Pexels/Pixabay stock clips for each scene. Clips shorter than the narration are looped automatically so there is no black tail.

### Step 4 — Voiceovers

FPT.AI TTS is dispatched per scene (async — polls until the mp3 URL is ready, 5s–2min per scene). The projected cost is checked against `COST_CAP_USD` before dispatching. If the projection would breach the cap, the pipeline halts.

**FPT.AI voices available:**

| Voice | Gender | Accent |
|---|---|---|
| `banmai` | female | northern |
| `thuminh` | female | northern |
| `lannhi` | female | southern |
| `linhsan` | female | southern |
| `leminh` | male | northern |
| `giahuy` | male | central |
| `myan` | female | central |

> Voice, speed, caption style, and music are fixed defaults in v1. The tune step is planned for a future release.

### Step 5 — Approve

The approval-gate UI shows the projected cost for the full render. Review it, then click **Approve** to proceed. The cost wall checks again at render time using actual `cost_ledger` events — the pipeline halts if the cap is exceeded.

### Step 6 — Render

The worker runs the full pipeline: Whisper captions → ASS karaoke subtitles → FFmpeg filter-graph (9:16 crop, ken-burns stills, clip looping, subtitle burn, music mix).

**Idempotent and resumable:** if the render is interrupted, re-approving re-runs only the missing pieces. Finished TTS/captions are reused at **$0**.

### Step 7 — Download / Publish

Download the final MP4 directly, or push to TikTok (requires `TIKTOK_ACCESS_TOKEN` and `publish.provider: tiktok` in worker config).

---

## 5. Cost

| Item | Per 30s video |
|---|---|
| Script (Agent SDK) | $0 (scriptUsd=0) |
| FPT.AI TTS (~400 chars) | ~$0.004 |
| Pexels / Jamendo | $0 (free tiers) |
| Whisper + FFmpeg (worker container) | $0 |
| **Total** | **< $0.01** |

The `COST_CAP_USD` cap (default `$0.15`) is checked at voiceover dispatch (projected) and tracked via `cost_ledger` events during render. Never disabled.

---

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Container fails to start | Check `docker compose logs <service>` — most commonly a missing `.env` key |
| `ass=` / subtitle filter error in worker logs | Worker container build missing libass — rebuild with `docker compose build worker` |
| `missing required config for selected providers` | Add the missing key to `.env` (only selected providers are checked) |
| TTS scene seems stuck | FPT.AI is async; it polls the returned mp3 URL until ready (5s–2min) — normal |
| Black tail at end of a scene | Stock clip shorter than narration; worker loops it — if it persists, re-run material step |
| Approval gate shows cost over cap | Reduce number of scenes or duration; or increase `COST_CAP_USD` in `.env` |

---

## 7. v1 limitations

- **No local-asset upload** (`--resource` descoped for v1) — stock footage only
- **No tune step** (voice, speed, caption style, music are fixed defaults in v1)
- **No re-publish** (`--force` descoped for v1)

---

## Next steps

- Full reference and architecture: [README.md](../README.md)
- Contributor guide: [CLAUDE.md](../CLAUDE.md)
