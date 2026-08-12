const fs = require("fs");
const path = require("path");
const { MERGE_SHORT_CUES } = require("../config");
const { parseVTT, parseTimestamp, buildTimestamp, serializeVTT } = require("./vtt");
const { cleanText, maxCharsForDuration, buildMergedCueData } = require("./merge");
const { phase1_ttsAndRewriteLoop } = require("./phase1");
const { phase2_combine } = require("./phase2");
const { getAudioDuration, isSilentAudio } = require("../services/audio");
const { fmtDuration, fmtTime } = require("../utils/format");
const L = require("../utils/logger");

// ── processPipeline ───────────────────────────────────────────────────────────

async function processPipeline(inputVTT, outputVTT, finalAudio, tmpDir) {
  if (!fs.existsSync(inputVTT)) {
    throw new Error(`File not found: ${inputVTT}`);
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY missing in .env");
  }

  const pipelineStart = Date.now();

  L.banner("PIPELINE: English VTT → TTS → Audio");

  const content = fs.readFileSync(inputVTT, "utf-8");
  const cues = parseVTT(content);

  if (!cues.length) {
    throw new Error("No cues found in VTT");
  }

  const rawCueData = cues.map((cue, idx) => {
    const { start, end } = parseTimestamp(cue.timestamp);
    const durationSec = Math.max(0.2, end - start);
    return {
      idx,
      cue,
      hinglishText: cleanText(cue.text.join(" ")),
      durationSec,
      maxChars: maxCharsForDuration(durationSec),
      start,
      end,
      timestamp: cue.timestamp,
      englishText: cleanText(cue.text.join(" ")),
      fit: null,
    };
  });

  const cueData = MERGE_SHORT_CUES
    ? buildMergedCueData(rawCueData)
    : rawCueData.map((r, i) => ({ ...r, id: i + 1, sourceIndexes: [i] }));

  const lastTs = parseTimestamp(cues[cues.length - 1].timestamp);

  L.kv("Input:", inputVTT);
  L.kv("Output VTT:", outputVTT);
  L.kv("Output audio:", finalAudio);
  L.kv("Original cues:", String(rawCueData.length));
  L.kv("Merged groups:", String(cueData.length));
  L.kv("Video duration:", fmtTime(lastTs.end));
  L.divider();
  console.log();

  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  // Phase 1 — TTS + rewrite loop
  const { results, phaseMs: p1Ms } = await phase1_ttsAndRewriteLoop(cueData, tmpDir);

  const finalVTTCues = cueData.map((c) => ({
    timestamp: c.timestamp || buildTimestamp(c.start, c.end),
    englishText: c.englishText,
  }));
  fs.writeFileSync(outputVTT, serializeVTT(finalVTTCues), "utf-8");

  // Phase 2 — combine
  const p2Ms = phase2_combine(results, tmpDir, finalAudio);

  // Silent-output guard — abort if the produced audio is silent so the caller
  // does not upload a broken file to S3.
  try {
    if (isSilentAudio(finalAudio)) {
      L.error(`Silent audio detected in generated output: ${finalAudio}`);
      throw new Error(`SILENT_OUTPUT: pipeline produced a silent audio file (${finalAudio}) — aborting before upload`);
    }
  } catch (err) {
    if (err.message && err.message.startsWith("SILENT_OUTPUT:")) throw err;
    L.warn(`Silence check on final audio failed to run: ${err.message}`);
  }

  // Final report
  const totalPipelineMs = Date.now() - pipelineStart;
  const totalDuration = getAudioDuration(finalAudio);
  const expectedTotal = lastTs.end;
  const fileSizeMB = (fs.statSync(finalAudio).size / 1024 / 1024).toFixed(1);

  const okCount      = results.filter((r) => r.status === "OK").length;
  const fittedCount  = results.filter((r) => r.status === "AUDIO_FIT").length;
  const totalRewrites = results.reduce((sum, r) => sum + r.rewrites, 0);
  const accuracy = ((1 - Math.abs(totalDuration - expectedTotal) / expectedTotal) * 100).toFixed(1);

  L.banner("PIPELINE COMPLETE");
  L.kv("English VTT:", outputVTT);
  L.kv("Final audio:", `${finalAudio}  [${fileSizeMB} MB]`);
  L.thinDivider();
  L.kv("Audio duration:", `${totalDuration.toFixed(2)}s  (expected ${expectedTotal.toFixed(2)}s)`);
  L.kv("Drift:", `${(totalDuration - expectedTotal).toFixed(2)}s`);
  L.kv("Match accuracy:", `${accuracy}%`);
  L.thinDivider();
  L.kv("Cues processed:", `${results.length}  (${rawCueData.length} original)`);
  L.kv("TTS fit 1st try:", `${okCount}  /  ${results.length}`);
  L.kv("Needed audio-fit:", String(fittedCount));
  L.kv("GPT rewrites:", String(totalRewrites));
  L.thinDivider();
  L.kv("Phase 1 TTS+rewrite:", fmtDuration(p1Ms));
  L.kv("Phase 2 combine:", fmtDuration(p2Ms));
  L.kv("► TOTAL TIME:", fmtDuration(totalPipelineMs));
  L.divider();
  console.log();

  return { totalPipelineMs, accuracy, totalDuration, expectedTotal };
}

// ── CLI entry point (node src/pipeline/index.js input.vtt output.vtt) ─────────

if (require.main === module) {
  require("dotenv").config();
  const args = process.argv.slice(2);

  const inputVTT  = args[0] || "input.vtt";
  const outputVTT = args[1] || inputVTT.replace(/\.vtt$/i, "_english.vtt");

  processPipeline(inputVTT, outputVTT, args[2] || "final_audio_english.wav", path.join(__dirname, "../../tmp_audio_pipeline"))
    .catch((err) => {
      console.error("❌ Fatal error:", err.message);
      process.exit(1);
    });
}

module.exports = { processPipeline };
