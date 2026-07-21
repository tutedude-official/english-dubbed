// ── Output normalization (English) ──────────────────────────────────────────

function normalizeOutput(text) {
  if (!text) return "";
  let t = String(text)
    .replace(/```json|```/g, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Remove any leftover Devanagari punctuation that GPT might leave
  t = t
    .replace(/।/g, ".")
    .replace(/\s*\.\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();

  return t;
}

module.exports = { normalizeOutput };
