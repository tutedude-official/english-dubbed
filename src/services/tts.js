const fs = require("fs");
const { execFileSync } = require("child_process");
const { SARVAM_API_KEY, SARVAM_MODEL, SARVAM_SPEAKER, SAMPLE_RATE } = require("../config");

async function callTTS(text, outputFile) {
  const response = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": SARVAM_API_KEY,
    },
    body: JSON.stringify({
      text: text,
      target_language_code: "en-IN",
      model: SARVAM_MODEL,
      speaker: SARVAM_SPEAKER,
      pace: 1.0,
      temperature: 0.6,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Sarvam TTS failed (${response.status}): ${errBody}`);
  }

  const data = await response.json();
  const audioBase64 = data.audios[0];
  const buffer = Buffer.from(audioBase64, "base64");
  const tmpFile = outputFile + ".tmp.wav";
  fs.writeFileSync(tmpFile, buffer);

  // Normalize to mono 24kHz PCM s16le to match the rest of the pipeline
  execFileSync("ffmpeg", [
    "-y", "-i", tmpFile,
    "-ar", String(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", outputFile,
  ], { stdio: "pipe" });

  // Clean up temp file
  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
}

module.exports = { callTTS };
