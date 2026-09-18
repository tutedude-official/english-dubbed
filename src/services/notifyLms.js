// Notifies the LMS backend that a dubbed audio lecture is ready.
// Configured via env:
//   LMS_WEBHOOK_URL     e.g. https://api.tutedude.com/api/lecture-audio/webhook
//   LMS_WEBHOOK_SECRET  shared secret (matches DUB_WEBHOOK_SECRET in lms-backend)
// No-op (warns) if either is unset, so the pipeline never fails just because
// the notify is not configured.
const L = require("../utils/logger");

const LMS_WEBHOOK_URL = process.env.LMS_WEBHOOK_URL;
const LMS_WEBHOOK_SECRET = process.env.LMS_WEBHOOK_SECRET;

// This pipeline only produces English (Indian) dubs, so the display label the
// LMS/player shows is fixed.
const DEFAULT_LABEL = "English (Indian)";

/**
 * POST a completed-dub notification to the LMS backend.
 * @param {Object} p
 * @param {string} p.lectureId   - Lecture ObjectId (the S3 folder name)
 * @param {string} [p.language]  - Language code, defaults to 'en'
 * @param {string} [p.accent]    - Accent code, defaults to 'ind'
 * @param {string} p.s3Key       - Audio object key, e.g. 'dubbed-production/en/ind/<id>/audio.wav'
 * @param {string} [p.subtitleS3Key] - Captions (.vtt) object key
 * @param {number} [p.durationSec]   - Audio duration in seconds
 * @param {string} [p.label]         - Display label; defaults to e.g. "English (Indian)"
 * @returns {Promise<{ok:boolean, skipped?:boolean, status?:number, error?:string}>}
 */
async function notifyLmsDubReady({
  lectureId,
  language = "en",
  accent = "ind",
  s3Key,
  subtitleS3Key,
  durationSec,
  label,
}) {
  if (!LMS_WEBHOOK_URL || !LMS_WEBHOOK_SECRET) {
    L.warn("LMS webhook not configured (LMS_WEBHOOK_URL / LMS_WEBHOOK_SECRET) — skipping notify");
    return { ok: false, skipped: true };
  }
  if (typeof fetch !== "function") {
    L.warn("global fetch unavailable (Node <18) — skipping LMS notify");
    return { ok: false, skipped: true };
  }

  const displayLabel = label || DEFAULT_LABEL;

  try {
    const res = await fetch(LMS_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-dub-webhook-secret": LMS_WEBHOOK_SECRET,
      },
      body: JSON.stringify({ lectureId, language, accent, s3Key, subtitleS3Key, durationSec, label: displayLabel }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      L.warn(`LMS notify failed (${res.status}): ${body?.message || "unknown error"}`);
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (err) {
    L.warn(`LMS notify error: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = { notifyLmsDubReady };
