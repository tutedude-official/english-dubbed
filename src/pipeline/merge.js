const {
  TOLERANCE_OVER,
  TOLERANCE_UNDER,
  MERGE_SHORT_SLOT_SECONDS,
  MERGE_SHORT_SLOT_MAXCHARS,
  MERGE_MAX_GAP_SECONDS,
  MERGE_MAX_COMBINED_SECONDS,
  MERGE_MAX_GROUP_CUES,
  MERGE_MAX_GROUP_WORDS,
} = require("../config");
const { buildTimestamp } = require("./vtt");

// ── Text helpers ──────────────────────────────────────────────────────────────

function cleanText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function wordCount(text) {
  return cleanText(text).split(/\s+/).filter(Boolean).length;
}

function countSpeakableChars(text) {
  return String(text || "")
    .normalize("NFC")
    .replace(/<[^>]*>/g, "")
    .replace(/[\s,!?;:.\-–—'"(){}[\]<>]/g, "")
    .length;
}

// ── Chars-per-second tuned for English TTS ────────────────────────────────────
// English TTS typically speaks ~13-15 chars/sec (slower than Hindi Devanagari)

function getCharsPerSecondForSlot(durationSec) {
  if (durationSec <= 1.0) return 12.0;
  if (durationSec <= 2.0) return 13.0;
  if (durationSec <= 3.0) return 13.5;
  if (durationSec <= 5.0) return 14.0;
  return 14.5;
}

function maxCharsForDuration(durationSec) {
  return Math.max(4, Math.floor(durationSec * getCharsPerSecondForSlot(durationSec)));
}

// ── Sentence boundary helpers ─────────────────────────────────────────────────

function endsLikeContinuation(text) {
  const t = cleanText(text);
  if (!t) return false;
  return /(?:,|:|-|—|\b(?:and|or|but|so|because|then|that|which|who|when|while|if|to|for|of|with|in|on|at|from)\b)$/i.test(t);
}

function startsLikeContinuation(text) {
  const t = cleanText(text);
  if (!t) return false;
  return /^(?:and|or|but|so|because|then|that|which|who|when|while|if|to|for|of|with|in|on|at|from)\b/i.test(t);
}

function endsWithStrongSentenceEnd(text) {
  return /[.!?]["']?$/.test(cleanText(text));
}

// ── Fit classification ────────────────────────────────────────────────────────

function classifyFit(englishText, durationSec) {
  const chars = countSpeakableChars(englishText);
  const budget = maxCharsForDuration(durationSec);
  const ratio = chars / Math.max(budget, 1);

  if (ratio > 1 + TOLERANCE_OVER) {
    return { status: "TOO_LONG", ratio, chars, budget };
  }
  if (durationSec >= 2.4 && ratio < 1 - TOLERANCE_UNDER) {
    return { status: "TOO_SHORT", ratio, chars, budget };
  }
  return { status: "OK", ratio, chars, budget };
}

// ── Merge logic ───────────────────────────────────────────────────────────────

function isShortCueForMerge(cue) {
  return (
    cue.durationSec <= MERGE_SHORT_SLOT_SECONDS ||
    cue.maxChars <= MERGE_SHORT_SLOT_MAXCHARS ||
    wordCount(cue.hinglishText) <= 3
  );
}

function shouldMergeGroupWithNext(group, nextCue) {
  const gap = nextCue.start - group.end;
  if (gap > MERGE_MAX_GAP_SECONDS) return false;
  const combinedDuration = nextCue.end - group.start;
  if (combinedDuration > MERGE_MAX_COMBINED_SECONDS) return false;
  const cw = wordCount(group.hinglishText);
  const nw = wordCount(nextCue.hinglishText);
  if (cw + nw > MERGE_MAX_GROUP_WORDS) return false;
  if (group.sourceIndexes.length >= MERGE_MAX_GROUP_CUES) return false;

  const groupShort = group.durationSec <= MERGE_SHORT_SLOT_SECONDS || group.maxChars <= MERGE_SHORT_SLOT_MAXCHARS || cw <= 3;
  const nextShort = isShortCueForMerge(nextCue);
  const continuity = endsLikeContinuation(group.hinglishText) || startsLikeContinuation(nextCue.hinglishText);

  if (groupShort) return true;
  if (nextShort && group.durationSec < 2.2) return true;
  if (continuity) return true;
  if (!endsWithStrongSentenceEnd(group.hinglishText) && combinedDuration <= 5.5) return true;
  return false;
}

function buildMergedCueData(rawCueData) {
  const merged = [];
  let i = 0;
  while (i < rawCueData.length) {
    const first = rawCueData[i];
    const group = {
      idx: merged.length,
      sourceIndexes: [first.idx],
      start: first.start,
      end: first.end,
      hinglishText: cleanText(first.hinglishText),
      durationSec: first.durationSec,
      maxChars: first.maxChars,
      timestamp: first.timestamp,
      englishText: cleanText(first.englishText || first.hinglishText),
      fit: null,
    };
    while (i + 1 < rawCueData.length && shouldMergeGroupWithNext(group, rawCueData[i + 1])) {
      const next = rawCueData[i + 1];
      group.sourceIndexes.push(next.idx);
      group.end = next.end;
      group.hinglishText = cleanText(`${group.hinglishText} ${next.hinglishText}`);
      group.englishText = cleanText(`${group.englishText} ${next.englishText || next.hinglishText}`);
      group.durationSec = group.end - group.start;
      group.maxChars = maxCharsForDuration(group.durationSec);
      group.timestamp = buildTimestamp(group.start, group.end);
      i++;
    }
    merged.push(group);
    i++;
  }
  return merged.map((g, idx) => ({ ...g, idx, id: idx + 1 }));
}

module.exports = {
  cleanText,
  wordCount,
  countSpeakableChars,
  getCharsPerSecondForSlot,
  maxCharsForDuration,
  classifyFit,
  buildMergedCueData,
};
