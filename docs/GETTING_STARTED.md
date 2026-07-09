# Getting Started with vidgen

From zero to a ready-to-post 9:16 Vietnamese-voiced short video, step by step.

This guide takes you from install through your **first rendered video** and out to
publishing. Every step writes to a per-project JSON manifest, so you can stop after
any step and resume later — nothing is lost.

---

## 1. Prerequisites

vidgen orchestrates a few external binaries. Install these first.

| Tool | Why | Install |
|---|---|---|
| **Go 1.22+** | build vidgen | [go.dev/dl](https://go.dev/dl/) |
| **FFmpeg _with libass_** | render + burn-in captions | `brew install homebrew-ffmpeg/ffmpeg/ffmpeg` |
| **Whisper** | word-level caption timing | `brew install openai-whisper` (or `pip install openai-whisper`) |
| **claude CLI** | script generation (uses your subscription, no API key) | [claude.ai/code](https://claude.ai/code) — must be logged in |

> **⚠️ FFmpeg must have libass.** The Homebrew *core* formula dropped subtitle
> filters. Install from the `homebrew-ffmpeg` tap above, or captions fail with a
> confusing `ass=` filter error. Verify: `ffmpeg -filters | grep ass`.

If a binary lives somewhere non-standard, point vidgen at it with an env override:
`FFMPEG_BIN`, `FFPROBE_BIN`, `WHISPER_BIN`, `CLAUDE_BIN`.

---

## 2. Build

```bash
git clone https://github.com/cuongtranba/video-generation-skill
cd video-generation-skill
go build -o vidgen ./cmd/vidgen
./vidgen --help          # sanity check
```

---

## 3. API keys (`.env`)

Create a `.env` file in your working directory. **Only the keys for the providers
you actually use are required** — vidgen validates per-selected-provider.

```env
FPT_TTS_API_KEY=...      # console.fpt.ai        — Vietnamese TTS (required by default)
PEXELS_API_KEY=...       # pexels.com/api        — stock video (free, default material)
PIXABAY_API_KEY=...      # optional              — image fallback
JAMENDO_CLIENT_ID=...    # devportal.jamendo.com — background music (free)
TIKTOK_ACCESS_TOKEN=...  # developers.tiktok.com — only for `vidgen publish`
```

`.env` is gitignored. Real environment variables take precedence over the file.

For the default setup (FPT + Pexels + Jamendo) you need `FPT_TTS_API_KEY`,
`PEXELS_API_KEY`, and `JAMENDO_CLIENT_ID`.

---

## 4. (Optional) Choose your providers

Which service implements each pipeline stage is selected in a YAML config — **not**
in code. Skip this entirely to use the defaults.

Location: `~/.vidgen/config.yaml` (override per-command with `--config <path>`).
An absent file means pure defaults, i.e. the behavior below.

```yaml
tts:
  provider: fpt          # fpt (ElevenLabs = seam, not implemented yet)
  voice: banmai
  speed: 0
music:
  provider: jamendo      # jamendo | none
material:
  providers: [pexels, pixabay]   # ordered fallback chain
videogen:
  provider: none         # none (Runway/Kling = seam, not implemented yet)
publish:
  provider: none         # none | tiktok
```

### Providers currently supported

| Category | ✅ Implemented | 🕳️ Selectable seam (returns "not implemented") |
|---|---|---|
| `tts` | **FPT.AI** (`fpt`) | ElevenLabs |
| `music` | **Jamendo** (`jamendo`), `none` | — |
| `material` | **Pexels**, **Pixabay** (ordered fallback) | TikTok |
| `videogen` | — (`none` only) | Runway, Kling |
| `publish` | **TikTok** (`tiktok`) | YouTube, Instagram |

---

## 5. Make your first video

The flow is six steps: **new → material → tune → confirm → generate → publish**.
Each step advances the project's status and persists it.

### Step 1 — `new`: idea → scene script

The `claude` CLI turns your one-line idea into a scene-by-scene script (Vietnamese
narration + visual notes).

```bash
./vidgen new "3 lý do bạn nên uống nước ấm mỗi sáng" \
  --duration 30 --scenes 3 --tone casual
# → Project 7ccd643c created (3 scenes)
```

Bring your own media — scenes are written *around* your assets:

```bash
./vidgen new "review quán cà phê" --duration 45 --resource ./my-photos
```

> Note the **project ID** it prints (`7ccd643c` here). Every later command takes
> `--project <id>`. `./vidgen list` shows all projects and their status any time.

### Step 2 — `material`: fetch stock clips

Pulls a clip/image for every scene. Your own assets (`--resource`) come first; Pexels
then Pixabay fill the gaps. Clips shorter than the narration are looped so there's no
black tail.

```bash
./vidgen material --project 7ccd643c
```

### Step 3 — `tune`: voice, captions, music

```bash
./vidgen tune --project 7ccd643c \
  --voice banmai --speed 0 \
  --music-search "calm inspiring acoustic" --music-volume 0.3
```

Common flags:

| Flag | Meaning |
|---|---|
| `--voice` | FPT voice (table below) |
| `--speed` | speech rate −3..+3 |
| `--caption-font`, `--caption-size` | ASS caption style |
| `--music <file>` | local music file, looped + ducked |
| `--music-search "<tags>"` | Jamendo mood/genre search, top track auto-downloaded |
| `--music-volume` | 0–1, default 0.15 (0.3–0.4 recommended) |

**FPT.AI voices:**

| Voice | Gender | Accent |
|---|---|---|
| `banmai` | female | northern |
| `thuminh` | female | northern |
| `lannhi` | female | southern |
| `linhsan` | female | southern |
| `leminh` | male | northern |
| `giahuy` | male | central |
| `myan` | female | central |

### Step 4 — `confirm`: cost gate

vidgen enforces a hard **$0.10/video cap**. `confirm` projects the cost and refuses to
proceed if it would breach.

```bash
./vidgen confirm --project 7ccd643c
# → Projected cost: $0.0036 (cap $0.10) — OK
```

### Step 5 — `generate`: render

Runs the pipeline on an embedded NATS JetStream bus: parallel per-scene TTS, then
captions (Whisper → ASS karaoke), then the FFmpeg render.

```bash
./vidgen generate --project 7ccd643c --output video.mp4
```

**Idempotent & resumable:** every worker checks its output file before doing work. If
`generate` crashes or you rerun it, finished TTS/captions are reused at **$0** — only
missing pieces are recomputed.

### Step 6 — `publish` (optional)

Uploads the rendered video to the configured publish provider. Requires
`publish.provider: tiktok` in `config.yaml` **and** `TIKTOK_ACCESS_TOKEN`.

```bash
./vidgen publish --project 7ccd643c \
  --caption "3 lý do nên uống nước ấm" --privacy public
```

---

## 6. Where your files live

```
~/.vidgen/projects/<id>/
  manifest.json      # project state, scenes, style, cost ledger
  <assets...>        # stock clips, TTS mp3s, captions, music — all co-located
```

Because everything is in the manifest + co-located assets, projects are fully
resumable and re-runnable.

---

## 7. Cost

| Item | Per 30s video |
|---|---|
| Script (claude CLI) | $0 (subscription) |
| FPT.AI TTS (~400 chars) | ~$0.004 |
| Pexels / Jamendo | $0 (free tiers) |
| Whisper + FFmpeg (local) | $0 |
| **Total** | **< $0.01** |

The $0.10 cap is checked three times: projected at `confirm`, actual after each API
call, and paired at completion. Never disabled.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `ass=` / subtitle filter error | FFmpeg lacks libass — reinstall from `homebrew-ffmpeg/ffmpeg/ffmpeg` |
| `missing required config for selected providers` | add the missing key to `.env` (only selected providers are checked) |
| Script step hangs or errors | `claude` CLI not logged in — run it once interactively first |
| TTS seems stuck | FPT.AI is async; it polls the returned mp3 URL until ready (5s–2min) — normal |
| Black tail at end of a scene | stock clip shorter than narration; vidgen loops it — re-run `material` if it persists |
| `provider "x" not implemented yet` | you selected a seam-only provider; pick an implemented one (see table in §4) |

---

## Next steps

- Full reference and architecture: [README.md](../README.md)
- Contributor guide: [CLAUDE.md](../CLAUDE.md)
