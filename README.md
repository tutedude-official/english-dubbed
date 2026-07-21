# Hinglish → English Dub Pipeline

Converts Hinglish course lecture subtitles (VTT) into English voiceover audio using:
- **OpenAI GPT-4o-mini** for Hinglish → English translation
- **OpenAI TTS (tts-1)** for English text-to-speech
- **ffmpeg** for audio fitting, silence detection, and concatenation
- **AWS S3** for storing the final `.wav` and `.vtt` files

---

## Prerequisites

- Node.js 18+
- ffmpeg + ffprobe installed and on `PATH`
- OpenAI API key (used for both GPT translation and TTS)
- AWS S3 bucket + credentials

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy the example env file and fill in your credentials
cp .env.example .env

# 3. Place a Hinglish VTT file as input.vtt in the project root
```

---

## Scripts

| Command | Description |
|---|---|
| `npm test` | Run the full pipeline for a single test lecture |
| `npm run production` | Run the pipeline for all lectures in `data/course.json` |
| `npm run upload` | Re-upload already-converted files from `output/` to S3 |
| `npm run dev` | Same as `npm test` but with `--watch` for auto-restart |

---

## Project Structure

```
src/
  config/         ← all env vars and tuning constants
  utils/
    logger.js     ← colorful terminal output
    format.js     ← fmtDuration, fmtMs, timestamp helpers
  services/
    openai.js     ← GPT JSON model calls
    tts.js        ← OpenAI TTS API (English)
    audio.js      ← ffmpeg wrappers (atempo, pad, compress)
    s3.js         ← AWS S3 upload helper
  pipeline/
    vtt.js        ← VTT parser and serializer
    merge.js      ← cue merging and fit classification
    text.js       ← output normalization (English)
    phase1.js     ← translate Hinglish → English (GPT)
    phase2.js     ← TTS + duration rewrite loop (OpenAI TTS + GPT)
    phase3.js     ← combine audio segments with ffmpeg
    index.js      ← processPipeline() and translateVTT() exports
scripts/
  run-test.js     ← single-lecture test runner
  run-pipeline.js ← full production batch runner
  run-all.js      ← multi-course batch runner
data/
  course.json     ← course structure with lecture IDs and tpStream IDs
output/           ← generated per-lecture folders (gitignored)
```

---

## Output

Each processed lecture produces:

```
output/<lectureId>/
  input.vtt     ← original Hinglish VTT
  english.vtt   ← translated English VTT
  english.wav   ← final dubbed audio (also uploaded to S3)
```

S3 path: `s3://<S3_BUCKET>/<S3_PREFIX>/<lectureId>/english.{wav,vtt}`
