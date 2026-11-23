# Klipzo: Architecture (Deliverable 1)

Status: **draft for approval** · 2026-11-23

Klipzo is a Hindi-first, non-destructive video editor for Indian creators. It ships as a web app and a desktop app (Windows + macOS) from one codebase. This document covers the architecture, data model, project schema, API, risks and licensing. Companion files:

- [`project.schema.json`](../packages/schema/project.schema.json): the project file format (JSON Schema 2020-12)
- [`v1-sample.json`](../packages/schema/fixtures/v1-sample.json): a valid example project (also the test fixture)
- [`api/transcribe.openapi.yaml`](api/transcribe.openapi.yaml): the only server API in v1

---

## 0. Decisions

| #   | Decision                                                                                                                                                                          | Why                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **One compositor.** A single WebGL2 renderer draws every frame for both preview and export. Encoders (WebCodecs, or native FFmpeg on desktop) only compress frames they're given. | Preview and export match by construction. Every effect, grade and subtitle style is written once. No HarfBuzz/libass: the browser already shapes Devanagari correctly (shown in the prototype). |
| D2  | **Local-first.** Media, projects and most AI run on the user's device. No accounts, server storage or job queue in v1.                                                            | Free tier costs nothing to serve, works offline, and user media stays private. Postgres/Redis/Celery/S3/tus arrive with the cloud tier (after D7).                                              |
| D3  | **Hybrid speech-to-text.** Free tier: Whisper-small in the browser. Paid tier: one stateless GPU service running faster-whisper large-v3.                                         | Best Hindi accuracy where it's paid for. Only 16 kHz audio is uploaded, never video.                                                                                                            |
| D4  | **Desktop = Tauri 2 on Windows + macOS.**                                                                                                                                         | Most target users are on Windows laptops. One CI pipeline builds both.                                                                                                                          |
| D5  | **WebGL2 first; WebGPU only if perf targets fail.**                                                                                                                               | WebGL2 runs everywhere, including Safari/WKWebView. A second GPU backend would double the shader work.                                                                                          |
| D6  | **Frame-accurate offline export, not real-time recording.**                                                                                                                       | The prototype's MediaRecorder export ran in real time and froze when the window was hidden. Offline export runs faster than real time and isn't affected by the window being hidden.            |

Lessons from the prototype (`/prototype`) that shape this design:

- Whisper-small transcribes clean Hindi well in the browser.
- For Hindi→English, Whisper's own `translate` task is far better than translating its Hindi text with opus-mt.
- en→hi with opus-mt is fine, but only one line at a time (batching makes it repeat).
- Whisper emits `[Music]`-style tags on non-speech audio, so these must be filtered out.
- `ctx.filter` is missing in Safari, so grading must be done in shaders.
- An energy threshold can't tell music from speech, so we need a real voice detector (VAD).

---

## 1. System overview

```
┌──────────────────────── apps/web (Vite + React) ─────────┐   ┌─ apps/desktop (Tauri 2) ─┐
│  UI (React, Zustand)  ←→  engine (pure TS)                │   │ same web bundle           │
│        │                     │ commands / undo / resolver │   │ + Rust shell:             │
│        ▼                     ▼                            │   │   native file paths       │
│  render worker (OffscreenCanvas + WebGL2 compositor)      │   │   FFmpeg sidecar (LGPL)   │
│  media worker  (demux/decode/encode/mux, proxies)         │   │   OS notifications        │
│  ai workers    (Whisper, VAD, translate, scenes, faces)   │   └───────────────────────────┘
│  storage: OPFS (media, proxies, analysis) + IndexedDB     │
└───────────────────────────────┬───────────────────────────┘
                                │ paid tier only: 16 kHz Opus audio
                                ▼
                    services/transcribe (FastAPI + faster-whisper large-v3, GPU, stateless)
```

**The UI thread never decodes, renders or runs a model.** It sends commands to the engine and draws a small preview canvas that the render worker controls via `OffscreenCanvas`. This satisfies "no UI blocking, ever".

### Monorepo layout

Each package is created when it first gets code. Deliverable 2 created `apps/web`, `apps/desktop` and `packages/schema`.

```
apps/web            Vite + React + TS app (also the desktop frontend)
apps/desktop        Tauri 2 shell (Rust): file access, FFmpeg sidecar, notifications
packages/schema     Project types, JSON Schema, migrations, validation
packages/engine     Timeline model, commands (undo/redo), time math, resolver
packages/compositor WebGL2 renderer: layers, transforms, grade shaders, captions, scopes
packages/media      Ingest (magic-byte sniffing), demux/decode, proxies, thumbnails, waveforms, encode/mux
packages/ai         Worker-side models: Whisper, Silero VAD, opus-mt, scene detect, face detect, highlights
packages/ui         Shared React components (accessible, themed, Hindi + English strings)
services/transcribe Python FastAPI + faster-whisper (paid tier)
prototype           The single-file prototype, kept for reference only
```

Dependencies are kept small. Each one earns its place:

| Need                                   | Choice                                                     | Licence          |
| -------------------------------------- | ---------------------------------------------------------- | ---------------- |
| UI                                     | React, Zustand                                             | MIT              |
| Undo patches                           | Immer (`produceWithPatches`)                               | MIT              |
| Demux + mux MP4/MOV/WebM/MKV           | Mediabunny                                                 | MPL-2.0          |
| Decode/encode                          | WebCodecs (platform)                                       | n/a              |
| Fallback decode for unsupported codecs | Native FFmpeg (desktop) or an LGPL ffmpeg.wasm build (web) | LGPL-2.1         |
| ML runtime in browser                  | transformers.js + onnxruntime-web                          | Apache-2.0 / MIT |
| Face detection                         | MediaPipe Tasks Vision                                     | Apache-2.0       |
| Tests                                  | Vitest, Playwright                                         | MIT / Apache-2.0 |
| Lint + format                          | Biome                                                      | MIT / Apache-2.0 |
| Project validation                     | Ajv (JSON Schema 2020-12)                                  | MIT              |

---

## 2. Media pipeline

### 2.1 Ingest

1. **Sniff the type from magic bytes** (first 64 KB), never from the extension. Accept: MP4/MOV (`ftyp`), MKV/WebM (`1A 45 DF A3`), MP3 (`ID3` / frame sync), WAV (`RIFF…WAVE`), PNG, JPEG. Reject everything else with a clear message.
2. **Keep, don't copy, where possible.**
   - Desktop: store the file path.
   - Chromium web: store a `FileSystemFileHandle` in IndexedDB and re-request permission on open.
   - Safari/Firefox web: copy the file into OPFS.
3. **Content ID** = SHA-256 of (size + first 1 MB + last 1 MB). This is fast on multi-GB files and is used to cache analysis per asset.
4. **Proxy:** 540p H.264 with a keyframe every 0.5 s, so scrubbing never decodes more than 15 frames. Audio goes to Opus 48 kHz. Proxies are made in the media worker with WebCodecs, or with native FFmpeg on desktop and for codecs the platform can't decode (e.g. ProRes, HEVC on Windows without the extension).
   - Lightweight mode (mobile and low-end devices) uses 360p proxies.
5. **Analysis audio:** 16 kHz mono Int16 PCM in OPFS, the input for every AI feature.
6. **Thumbnails** (one per 2 s, 160 px) and a **waveform** (peak pairs, 100/s).

Editing always uses proxies. **Export always decodes the originals.**

### 2.2 Preview playback

- The render worker owns the clock.
  - For each display frame it asks the resolver what is visible at time `t` (§4.3).
  - It pulls decoded `VideoFrame`s from per-asset decoder pools, composites them, and transfers the result to the on-screen canvas.
- Audio: the media worker decodes proxy audio in 2-second chunks ahead of the playhead. The mixer schedules them as `AudioBufferSourceNode`s with per-clip gain and speed. The audio clock is the master; video drops frames rather than drifting.
- Target: 60 fps preview of a 1080p project on an 8 GB laptop.
  - Preview renders at the proxy's resolution scaled to the canvas size.
  - The grade runs as one shader pass, and captions are cached as textures until their text changes.

### 2.3 Export (D6)

```
for each output frame (frame-accurate, faster than real time):
  resolver(t) → render plan → compositor (original media, full res) → VideoFrame
  → VideoEncoder (H.264 / H.265 / VP9 / AV1, hardware when available)
audio: OfflineAudioContext renders the whole mix deterministically → AudioEncoder (AAC, or Opus for WebM)
mux: Mediabunny → MP4 / WebM file in OPFS or on disk (desktop)
```

- **Formats:**
  - MP4 H.264 everywhere.
  - H.265 where WebCodecs supports it (Safari/macOS; Windows with a hardware encoder), otherwise via the desktop FFmpeg sidecar using the OS encoder.
  - WebM (VP9/AV1).
  - GIF: render low-res frames, then palette-quantise with FFmpeg.
  - Audio-only: M4A or WAV.
- **Presets:** YouTube 1080p/4K, Reels/Shorts 1080×1920, WhatsApp (720p, under 16 MB target bitrate).
- **Queue and resume:** export renders 10-second segments to OPFS and records progress in IndexedDB.
  - After a crash, it resumes at the last finished segment; segments are joined at the end without re-encoding (each one starts on a keyframe).
  - Progress and ETA come from frames done per second. On completion it shows a desktop or browser notification.

---

## 3. Compositor and colour

### 3.1 Layer pipeline (per visible clip, one WebGL2 draw)

```
VideoFrame → texture
  → input transform (HLG/PQ/Log → Rec.709, only when metadata says so; §3.3)
  → grade (exposure, white balance, contrast, saturation/vibrance with skin protection, Lab match)
  → look (3D LUT texture or mood preset, mixed by intensity 0–100%)
  → geometry (fit / fill / blur-background, reframe crop, keyframed transform)
  → blend (opacity, transition)
captions/text: drawn with Canvas 2D in the worker (browser shapes Devanagari), uploaded as a texture
```

All colour maths lives in **one GLSL file** (`grade.glsl`) with a matching **TypeScript CPU reference** (`grade.ref.ts`). Golden-frame tests render fixed input images through the GPU and compare them with the reference within ±2/255 per channel. Preview and export run the same shader, so parity between them needs no separate test.

### 3.2 Auto Grade

These are measured on 8 frames per clip, read back at 64×36:

- luma percentiles (p1 / p50 / p99) and clipping %
- grey-world white balance, from mid-tone pixels that are neither skin nor saturated
- mean saturation
- a **skin mask** (YCbCr skin range plus a hue band)

The result is an **editable `grade` object** (§5) that is never baked into the pixels:

- **Exposure** moves p50 towards 0.45 (capped at ±1.5 EV).
- **Contrast** moves the p1–p99 spread towards the target.
- **White balance** neutralises the grey-world cast (capped).
- **Saturation/vibrance** brings mean saturation up to the target.
- **Skin protection** limits hue rotation inside the skin band to ±3° and its saturation gain to 1.15×, so faces never turn orange or grey.
- Clips that are already in range get no change (all deltas below threshold). The prototype showed this matters for intentionally dark scenes.

**Match colour:** a Reinhard transfer in Lab space. For each channel, the target clip's mean and standard deviation are scaled to the reference clip's. This is stored as `match.scale[3]` / `match.offset[3]`, so it's editable and removable.

**Moods:** Warm, Teal-orange, Moody, Bright vlog and Black & white. Each is a parameter set plus an optional built-in LUT, with an intensity slider. Users can import `.cube` LUTs (17³ to 65³), which are validated and stored per project.

**Scopes:** histogram, waveform and vectorscope are computed on the GPU from the preview frame at 256×144. A clipping warning appears when more than 2% of pixels are at 0 or 255 after the grade.

**Before/after:** a split-view shader uniform. **Per-clip override:** `grade.enabled` plus manual edits, which turn `grade.auto` to `false`.

### 3.3 Log / HDR detection

- **Metadata first.** If the container's colour transfer is HLG (`arib-std-b67`) or PQ (`smpte2084`), the matching transform is applied automatically. Known Log tags (Apple Log, S-Log3, D-Log M, where the container exposes them) are handled the same way.
- **Heuristic second, and only as a suggestion.** Flat histogram, no clipping and low saturation trigger "This looks like Log footage. Apply S-Log3 → Rec.709?" It is never applied silently.

---

## 4. Engine

### 4.1 Time

All times are **integer microseconds** (`*Us`). This avoids floating-point drift, and JSON integers are exact for about 285 years. Frame snapping uses the project's rational fps.

### 4.2 Commands, undo and autosave

Every edit is a **command**. It runs as an Immer `produceWithPatches` on the project and produces `{label, patches, inversePatches}`.

- **Undo/redo:** apply the inverse or forward patches. History is unlimited and cheap, because patches are diffs.
- **Autosave:** the patches also go to an IndexedDB journal. A full snapshot is written every 30 s or every 200 patches.
- **Crash recovery:** last snapshot + replay journal. An edit is in the journal within 1 s, so at most 1 s of work can be lost.
- **Version history:** named snapshots ("before auto-cut") cost one snapshot each.
- **Desktop:** additionally writes `.klipzo` files on save. On web, "Save project" downloads the same JSON, with media referenced by content ID.
- **Migrations:** `schemaVersion` plus one pure function per step (`v1→v2`, …), all run on load. Each is tested with the previous version's fixtures.

Commands needed by the spec include:

- clip edits: add, move, trim, split, ripple-delete, speed, reverse
- clipboard and markers: copy/paste, markers
- grading: set grade, apply auto grade, match colour
- cut sets: apply cut set, accept/reject cut
- captions: caption edits (text, timing, split/merge, speaker)

Multi-select edits are one command, so they undo as one step.

### 4.3 Resolver (the shared core)

`resolve(project, tUs) → RenderPlan` is a **pure function**. It returns the visible layers (asset, source time, transform, opacity, grade, transition state), active captions and audio segments. Preview, export, thumbnails and tests all call it.

Cut sets (§4.4) are applied here. A clip's effective source ranges are `[in, out]` minus its accepted cut regions, and the timeline ripples accordingly. The clip itself is never split, so rejecting a cut restores it exactly.

Captions anchored to a clip are stored in that clip's source time and mapped through the same function. Subtitles therefore stay in sync after trims, reorders, speed changes and silence cuts automatically. This was proven in the prototype (`subsFromTranscripts`).

### 4.4 Silence and filler cutter

- **Voice detection:** Silero VAD (ONNX, in a worker) on the 16 kHz analysis audio, giving speech probability per 32 ms. It is robust to background noise, music and breathing, unlike the prototype's energy threshold.
- **Controls:** threshold (dB floor, plus VAD probability), minimum silence (0.3–2 s), padding before and after (default 100 ms), and keep pauses shorter than X.
- **Modes:**
  - _Remove_: regions marked accepted.
  - _Shorten_: each silence is trimmed to the target length.
  - _Mark only_: regions are proposed and shown in red on the timeline.
- **Review:** accept/reject per region, a "time saved" counter, and accept/reject all.
- **Fillers:** use the transcript's word timestamps and a filler list per language (default: um, uh, matlab, basically, तो, मतलब, …) that the user can edit.
- **Jump-cut smoothing:**
  - Audio: a 10 ms crossfade at every cut, applied in the mixer.
  - Video: optional punch-in (scale 1.05–1.10 on alternate segments), applied by the resolver.
- **Batch mode:** run over many clips at once. It runs on analysis audio, so it never decodes video.

### 4.5 Subtitles

- **Free tier (in browser):** Whisper-small via transformers.js.
  - Hindi speech gives Devanagari text. English comes from Whisper's `translate` task, i.e. it listens again.
  - English speech gives English text. Hindi comes from opus-mt-en-hi, one line at a time.
  - Word timestamps need a Whisper export that includes attention outputs. Deliverable 4 checks this; if it isn't available, words are interpolated within each segment.
  - Non-speech tags (`[Music]`, `(applause)`, ♪) are dropped.
- **Paid tier:** faster-whisper large-v3 with `word_timestamps`, a VAD filter and language auto-detect. It handles mixed Hindi/English audio better.
- **Hinglish (Roman Hindi):**
  - Transliterate from Devanagari, or transcribe Hindi and then transliterate.
  - Server: AI4Bharat IndicXlit.
  - Browser: a rule-based Devanagari→Hinglish mapper (casual spellings such as "hai", "kya", "matlab"), with the custom dictionary taking priority.
  - The Devanagari ↔ Roman toggle is non-destructive: both forms are stored per segment.
- **"Fix subtitles":**
  - custom dictionary (names, brands, Hindi spellings)
  - a common-error map (e.g. मे→में where the context matches)
  - stripping of repeated n-grams (a known Whisper failure)
  - Each change is listed, so it can be reviewed and undone.
- **Editing:** text and timing on the timeline, split/merge lines, speaker labels.
- **Styles:** Noto Sans Devanagari, Mukta and Poppins (all OFL, bundled).
  - Outline, shadow, background box, pop-in animation, and karaoke word highlight (needs word timestamps).
  - The position respects the safe area for each ratio. For 9:16, captions stay clear of the bottom 20% where the Reels and Shorts interface sits.
- **Formats:** SRT/VTT/ASS import and export. ASS styles map to the nearest Klipzo style.

### 4.6 Clips and AI

- **Scene split:** HSV-histogram difference on proxy frames sampled at 4 fps, with an adaptive threshold. Results are suggested split points.
- **Highlights (15/30/60 s):** score sliding windows by
  - speech density
  - loudness peaks and laughter/applause (VAD + energy)
  - scene-cut rhythm
  - face presence
  - transcript cues (question/answer, numbers, "the key thing is", hooks in the first 3 s)

  Each suggestion includes a score and plain reasons ("clear hook at 0:02, 3 faces, no dead air"). The paid tier can add an LLM pass over the transcript to write better reasons and titles.
- **"Make 5 reels":** for the top 5 windows, apply
  - the 9:16 ratio and auto-reframe
  - silence cut
  - subtitles in the chosen style
  - auto grade
  - a style preset

  Each reel is a new sequence in the same project, so it stays editable.
- **Auto-reframe:** MediaPipe face detection at 5 fps on the proxy, then a tracker (nearest-face association), then a critically damped spring for smoothing. The result is crop keyframes stored in `clip.reframe`.
  - No face: follow the motion centroid, else hold the centre.
  - Modes: Fit, Fill, Blur-background.
- **Clip library:** saved ranges with tags, searchable by tag and transcript text, stored in the project.

---

## 5. Data model (summary of `project.schema.json`)

```
Project
├─ schemaVersion, id, name, createdAt, updatedAt
├─ settings        ratio {w,h}, outputHeight, fps {num,den}, sampleRate, defaultFit, background
├─ assets{id}      kind (video|audio|image), contentHash, size, mime (sniffed), durationUs,
│                  video {width,height,fps,rotation,codec,transfer}, audio {channels,sampleRate},
│                  source {type: path|handle|opfs|url, ref}, proxy {status, ref}
├─ sequences[]     id, name, tracks[] (main edit + one per "make 5 reels" output)
│  └─ tracks[]     kind (video|audio|text|overlay), muted, locked, hidden, clips[]
│     └─ clips[]   media: assetId, startUs, inUs, outUs, speed, reverse, volume, fit,
│                         transform{x,y,scale,rotation} (keyframable), opacity (keyframable),
│                         transitionIn {type,durationUs}, grade, reframe, effects[]
│                  text:  startUs, durationUs, text, style
├─ cutSets[]       clipId, kind (silence|filler), mode, params, regions[] {startUs,endUs,status,reason}
├─ captionTracks[] sequenceId, lang (hi|en|hi-Latn), style, visible,
│                  segments[] {anchor (clip|timeline), startUs, endUs, text, roman?, words[], speaker, edited}
├─ library[]       saved clip ranges {assetId, inUs, outUs, tags[], note}
├─ markers[]       sequenceId, timeUs, label, color
├─ luts{id}        name, size, data ref (OPFS)
└─ dictionary[]    {from, to, lang}
```

Bulky analysis results are **not** in the project file. These are transcripts, VAD output, scene cuts, face tracks, colour stats, waveforms and thumbnails. They live in OPFS, keyed by asset `contentHash` plus analysis version, so they're shared across projects and recomputable. The project stores only _decisions_: cuts, grades, caption text.

---

## 6. API specification

### 6.1 Transcription service (only server API in v1)

The full spec is in [`api/transcribe.openapi.yaml`](api/transcribe.openapi.yaml).

| Method   | Path                      | Purpose                                                                                                 |
| -------- | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `POST`   | `/v1/transcriptions`      | Upload 16 kHz mono Opus audio (≤ 50 MB, ≤ 3 h) with language and options. Returns `202 {id}`.           |
| `GET`    | `/v1/transcriptions/{id}` | Status, progress, and the result (segments with word timestamps, optional translation and Roman forms). |
| `DELETE` | `/v1/transcriptions/{id}` | Delete the result now; it is otherwise auto-deleted after 24 h.                                         |
| `GET`    | `/v1/health`              | Liveness, model loaded, GPU memory.                                                                     |

- **Auth:** Bearer token issued by the licence/payment provider for paid users.
- **Limits:**
  - Per-user rate limit: 10 jobs per hour and 300 audio minutes per day.
  - Max 50 MB and 3 h per upload.
  - Errors use RFC 9457 problem+json.
- **Privacy:** audio is deleted as soon as the job finishes. It is never logged and never used for training.
- **Scaling:** no queue service in v1. Each GPU instance runs one job at a time with an in-process queue, and the platform autoscales instances.
- **Failure:** retries with backoff (3 tries). If the service is down, the app falls back to in-browser Whisper and says so (graceful degradation).

### 6.2 Internal worker protocol (TypeScript, versioned with the app)

```ts
// UI → render worker
type RenderMsg =
  | { type: 'load'; project: Project }
  | { type: 'patch'; patches: Patch[] } // same Immer patches as undo/autosave
  | { type: 'seek'; tUs: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'view'; split?: number; scopes?: ScopeKind[] };
// render worker → UI
type RenderEvt = { type: 'time'; tUs: number } | { type: 'scopes'; data: ScopeData } | { type: 'error'; error: string };

// UI → AI worker (all long-running, cancellable, progress-reporting)
type AiJob =
  | { type: 'transcribe'; assetHash: string; lang: 'auto' | 'hi' | 'en'; translate: boolean; engine: 'local' | 'cloud' }
  | { type: 'vad'; assetHash: string }
  | { type: 'scenes'; assetHash: string }
  | { type: 'faces'; assetHash: string }
  | { type: 'colorStats'; assetHash: string; frameTimesUs: number[] };
type AiEvt = { jobId: string } & (
  | { type: 'progress'; stage: string; pct: number }
  | { type: 'done'; ref: string }
  | { type: 'error'; error: string }
);
```

### 6.3 Later (cloud tier, not built in v1)

Accounts, project sync, cloud 4K export and server-side AI clips. These bring FastAPI + PostgreSQL + Redis/Celery + S3 (signed URLs, per-user prefixes), tus resumable uploads, ClamAV scanning and sandboxed FFmpeg workers (no shell, fixed argument allow-list, CPU/time/memory limits, no network). The data model above already uses content hashes and asset `source.type = url`, so sync needs no schema change.

---

## 7. Performance plan

| Target                                 | How                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 60 fps 1080p preview on an 8 GB laptop | 540p short-GOP proxies; decode and composite in workers; one shader pass per layer; caption textures cached; at most 3 decoder instances per asset.                            |
| No UI blocking                         | Everything heavy runs in workers. The UI thread only runs React and sends patches. A CI performance test fails if any main-thread task in the editing flow exceeds 50 ms.      |
| Low-end and mobile                     | Lightweight mode: 360p proxies, preview at half resolution, scopes off, live grade preview simplified to exposure, contrast and saturation (export still uses the full grade). |
| Memory                                 | Decoded frames are closed after use. A bounded frame cache of 2 s ahead plus 1 s behind per active asset. Analysis audio streamed from OPFS.                                   |
| Export speed                           | Hardware encoders through WebCodecs; above real time at 1080p on mid-range laptops (measured in Deliverable 7).                                                                |

---

## 8. Security and reliability

- **Trust boundaries:**
  - Files the user picks are untrusted. Magic-byte sniffing, size/duration limits and decoding in sandboxed workers or WebCodecs protect against them.
  - Native FFmpeg gets file paths plus a fixed, allow-listed argument set, and is never run through a shell.
  - LUT and subtitle parsers are fuzzed in CI.
- **Desktop:** Tauri capability allow-list (file system access only through the dialog and app data dir), Content Security Policy enabled, and signed builds (Windows Authenticode, macOS notarisation).
- **Server (paid transcription):** TLS, bearer auth, rate limits, audio size checks and an Ogg/Opus magic check. No persistent storage of audio. Structured JSON logs without audio or text content, plus Sentry for errors and a health endpoint.
- **Client:** errors are reported to Sentry only with consent and without media or text. AI failures degrade to "skip with a message", never a broken project.

---

## 9. Licensing and legal (needs counsel review before launch; this is not legal advice)

| Item                                           | Finding                                                                                                                                                                                                                         | Action                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| H.264 / H.265 patents                          | Encoding with the OS or browser encoder (WebCodecs, VideoToolbox, Media Foundation) uses the platform vendor's licence. Shipping our own x264/x265 encoder would need Via LA / Access Advance licences and makes the build GPL. | **Never bundle x264/x265.** H.265 is offered only where a platform encoder exists. Counsel to confirm for a paid product in India and abroad. |
| FFmpeg (desktop sidecar)                       | LGPL-2.1 when built without `--enable-gpl` / `--enable-nonfree`.                                                                                                                                                                | Ship an LGPL build as a separate executable. Publish its source and build script, and add a notice in the About screen.                       |
| ffmpeg.wasm                                    | The stock `@ffmpeg/core` includes x264, which makes it GPL.                                                                                                                                                                     | Build our own LGPL wasm core (decode and remux only), or skip wasm and rely on WebCodecs plus the desktop sidecar. Decided in Deliverable 3.  |
| Fonts                                          | Noto Sans Devanagari, Mukta and Poppins: SIL OFL 1.1. Bundling and burning into videos is allowed; selling the fonts on their own is not.                                                                                       | Bundle with the licence files.                                                                                                                |
| Whisper weights, faster-whisper, CTranslate2   | MIT                                                                                                                                                                                                                             | Attribution in notices.                                                                                                                       |
| opus-mt-en-hi                                  | CC-BY-4.0                                                                                                                                                                                                                       | **Attribution required** in the app and docs.                                                                                                 |
| Silero VAD                                     | MIT · **MediaPipe:** Apache-2.0 · **IndicXlit:** MIT · **transformers.js:** Apache-2.0 · **onnxruntime-web:** MIT                                                                                                               | Attribution in notices.                                                                                                                       |
| Mediabunny                                     | MPL-2.0 (file-level copyleft)                                                                                                                                                                                                   | Use unmodified, or publish modified files.                                                                                                    |
| Tauri, React, Zustand, Immer                   | MIT/Apache                                                                                                                                                                                                                      | Notices.                                                                                                                                      |
| LUTs, music, effects                           | None bundled in v1 except LUTs we create (our copyright).                                                                                                                                                                       | Any future stock content needs a written licence covering redistribution in exported videos.                                                  |
| Test media                                     | Social-media downloads (e.g. the two clips used to test the prototype) can't go into a public test set.                                                                                                                         | Use FLEURS Hindi (CC-BY-4.0), Common Voice Hindi (CC0), MUSAN noise (CC-BY-4.0), plus our own recordings with written consent.                |
| User content and privacy (India DPDP Act 2023) | Local-first means the free tier collects no media. Paid transcription processes audio as a data processor, so it needs a consent notice, a 24 h retention limit and a deletion endpoint (done in §6.1).                         | Privacy policy before launch.                                                                                                                 |

---

## 10. Quality and benchmarks

- **CI (Deliverable 2):** lint and format (Biome), typecheck (tsc), unit tests (Vitest), a check that generated schema types are current, Playwright end-to-end tests (Chromium + WebKit), and Tauri builds for Windows and macOS. Ruff, mypy and pytest join when `services/transcribe` is added (Deliverable 4).
- **Golden frames:** fixed input images go through the GPU compositor and are compared with the CPU reference (±2/255). Covered:
  - exposure and white-balance correction on known casts
  - skin-tone protection, where the skin patch's hue must stay within ±3°
  - transitions and caption rendering, including Devanagari conjuncts (क्ष, त्र, ज्ञ, श्र) and vowel signs, compared against reference PNGs
- **Hindi word error rate (WER):** a benchmark script on FLEURS hi_in test, Common Voice Hindi, and a Hinglish set we record. Reports WER and character error rate (CER) for the local (Whisper-small) and cloud (large-v3) engines. It runs nightly, not on every PR (too slow).
- **Silence cutter:** clean Hindi/Hinglish/English speech mixed with MUSAN noise at 20/10/5 dB SNR, against hand-labelled silences. It reports:
  - **false-cut rate:** speech wrongly removed, in ms of speech, target < 0.5%
  - **missed-silence rate:** target < 10%
  - **caption sync:** after cuts, every caption still overlaps its spoken words, checked automatically through the resolver
- **Prototype bugs become regression tests:**
  - `[Music]` tags must not become subtitles
  - ratio choice must follow the running time
  - opus-mt must not repeat itself (translate one line at a time)
  - export must not depend on the window being visible

---

## 11. Risks

| Risk                                                         | Likelihood | Impact           | Mitigation                                                                                                                                      |
| ------------------------------------------------------------ | ---------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| WebCodecs/WebGL gaps in WKWebView (macOS desktop) and Safari | Medium     | High             | Feature-detect at start. The desktop FFmpeg sidecar covers decode/encode gaps. Playwright WebKit runs in CI from Deliverable 3.                 |
| AAC `AudioEncoder` missing on some platforms                 | Medium     | Medium           | Fall back to Opus in MP4, or encode AAC in the FFmpeg sidecar (desktop) or a small LGPL wasm core (web).                                        |
| Memory on 8 GB machines and phones with long videos          | High       | High             | Proxies, a bounded frame cache, streamed analysis audio, and lightweight mode. A 1-hour project is in the performance suite.                    |
| Hindi/Hinglish accuracy of in-browser Whisper-small          | High       | High (the wedge) | Hybrid engine (D3), "fix subtitles", custom dictionary, and the WER benchmark to decide when free users get cloud minutes.                      |
| Hinglish romanisation quality (no standard spelling)         | High       | Medium           | IndicXlit on the server, a rule mapper in the browser, a user dictionary, and both forms stored.                                                |
| Word-level timestamps in the browser                         | Medium     | Medium           | Validated in Deliverable 4; interpolation fallback; cloud engine gives true word times.                                                         |
| ffmpeg.wasm licensing and size (~30 MB)                      | Medium     | Medium           | Custom LGPL build, loaded only when needed, or not at all (decided in Deliverable 3).                                                           |
| OPFS quota or eviction losing proxies                        | Low        | Low              | Proxies and analysis are recomputable. Originals are never only in OPFS on desktop. `navigator.storage.persist()` is requested.                 |
| Scope: the spec is a multi-quarter product                   | High       | High             | Deliverables are gated. Cloud tier, accounts and team features are explicitly after D7.                                                         |
| Auto Grade brightening intentionally dark scenes             | Medium     | Low              | Measured deltas with thresholds, a per-clip override, a before/after view, and a "keep mood" heuristic (low key + high contrast = leave alone). |

---

## 12. Delivery plan

| Deliverable  | Scope                                                                                                                                                    | Exit check                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **1** (this) | Architecture, schema, API, risks, licensing                                                                                                              | Your approval                                                                               |
| **2**        | Monorepo (pnpm workspaces), CI (lint, typecheck, Vitest, Playwright, Tauri build matrix), schema package with validation and migrations, empty app shell | CI green on Windows + macOS                                                                 |
| **3**        | MVP: ingest + proxies → timeline (drag, trim, split, ripple, snapping, zoom, shortcuts, undo) → ratio/fit → export MP4. Autosave + crash recovery.       | End-to-end: upload two files, cut, change ratio, export, and check frame count and duration |
| **4**        | Subtitles: local + cloud transcription, translation, Hinglish, fix pass, editor, styles, SRT/VTT/ASS                                                     | WER report; Devanagari golden frames                                                        |
| **5**        | Silence/filler cutter, scene split, highlights, "make 5 reels", auto-reframe, clip library                                                               | False-cut and missed-silence report; captions stay in sync after cuts                       |
| **6**        | Transitions, keyframes, speed/reverse, style presets, Auto Grade, match colour, moods, LUTs, Log/HDR, scopes                                             | Grade golden frames, including skin protection                                              |
| **7**        | Desktop polish, performance and low-end pass, security review, deployment guide                                                                          | Performance targets met on a reference 8 GB laptop and a mid-range Android phone            |
