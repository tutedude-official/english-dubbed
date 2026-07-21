require("dotenv").config();

// ── API Keys ───────────────────────────────────────────────────────────────────
const OPENAI_API_KEY   = process.env.OPENAI_API_KEY;
const AWS_ACCESS_KEY_ID     = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_REGION       = process.env.AWS_REGION || "ap-south-1";
const S3_BUCKET        = process.env.S3_BUCKET || "tutedude694";
const NODE_ENV         = process.env.NODE_ENV || "development";
const S3_PREFIX        = process.env.S3_PREFIX || `dubbed-${NODE_ENV}/en/ind`;

// ── Sarvam TTS ───────────────────────────────────────────────────────────────
const SARVAM_API_KEY         = process.env.SARVAM_API_KEY;
const SARVAM_MODEL           = process.env.SARVAM_MODEL || "bulbul:v3";
const SARVAM_SPEAKER_MALE    = process.env.SARVAM_SPEAKER_MALE || "shubh";
const SARVAM_SPEAKER_FEMALE  = process.env.SARVAM_SPEAKER_FEMALE || "roopa";
const SARVAM_VOICE           = process.env.SARVAM_VOICE || "male";
const SARVAM_SPEAKER         = SARVAM_VOICE === "female" ? SARVAM_SPEAKER_FEMALE : SARVAM_SPEAKER_MALE;
const SAMPLE_RATE            = 24000;

// ── OpenAI GPT ────────────────────────────────────────────────────────────────
const GPT_MODEL = "gpt-4o-mini";

// ── Translation batching ──────────────────────────────────────────────────────
const BATCH_SIZE     = 16;
const BATCH_DELAY_MS = 350;

// ── TTS rewrite loop ──────────────────────────────────────────────────────────
const TOLERANCE_OVER      = 0.10;
const TOLERANCE_UNDER     = 0.10;
const MAX_REWRITE_ATTEMPTS = 3;
const REWRITE_DELAY_MS    = 300;

// ── Audio fitting ─────────────────────────────────────────────────────────────
const MAX_ATEMPO_RATIO  = 1.30;
const MIN_ATEMPO_RATIO  = 0.85;
const MIN_SILENCE_KEEP  = 0.05;

// ── Cue merging ───────────────────────────────────────────────────────────────
const MERGE_SHORT_CUES          = true;
const MERGE_SHORT_SLOT_SECONDS  = 1.35;
const MERGE_SHORT_SLOT_MAXCHARS = 12;
const MERGE_MAX_GAP_SECONDS     = 0.12;
const MERGE_MAX_COMBINED_SECONDS = 6.5;
const MERGE_MAX_GROUP_CUES      = 3;
const MERGE_MAX_GROUP_WORDS     = 24;

module.exports = {
  // API keys
  OPENAI_API_KEY,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_REGION,
  S3_BUCKET,
  S3_PREFIX,
  // Sarvam TTS
  SARVAM_API_KEY,
  SARVAM_MODEL,
  SARVAM_SPEAKER,
  SAMPLE_RATE,
  // OpenAI GPT
  GPT_MODEL,
  // Batching
  BATCH_SIZE,
  BATCH_DELAY_MS,
  // Rewrite loop
  TOLERANCE_OVER,
  TOLERANCE_UNDER,
  MAX_REWRITE_ATTEMPTS,
  REWRITE_DELAY_MS,
  // Audio
  MAX_ATEMPO_RATIO,
  MIN_ATEMPO_RATIO,
  MIN_SILENCE_KEEP,
  // Merging
  MERGE_SHORT_CUES,
  MERGE_SHORT_SLOT_SECONDS,
  MERGE_SHORT_SLOT_MAXCHARS,
  MERGE_MAX_GAP_SECONDS,
  MERGE_MAX_COMBINED_SECONDS,
  MERGE_MAX_GROUP_CUES,
  MERGE_MAX_GROUP_WORDS,
};
