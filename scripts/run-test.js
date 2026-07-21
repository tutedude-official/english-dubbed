require("dotenv").config();

// Parse --voice=male|female (default from .env SARVAM_VOICE)
const _voiceArg = process.argv.find(a => a.startsWith("--voice="));
if (_voiceArg) process.env.SARVAM_VOICE = _voiceArg.split("=")[1].toLowerCase();

const fs = require("fs");
const path = require("path");
const { processPipeline } = require("../src/pipeline");
const { uploadToS3 } = require("../src/services/s3");
const { S3_BUCKET, S3_PREFIX } = require("../src/config");
const { fmtDuration, fmtMs } = require("../src/utils/format");
const L = require("../src/utils/logger");

// ── Test config — single lecture ──────────────────────────────────────────────

const TEST_LECTURE = {
  lectureName: "Meta Ads Traffic ads part 2",
  tpStreamId: "GffkmXKJ58m",
  _id: { $oid: "6892146302969a2f9e5261b0" },
};

const LOCAL_VTT    = path.join(__dirname, "../input.vtt");
const OUTPUT_DIR   = path.join(__dirname, "../output");

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const runStart = Date.now();

  if (!process.env.OPENAI_API_KEY) { L.error("OPENAI_API_KEY missing in .env"); process.exit(1); }
  if (!process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID === "your_aws_access_key_here") {
    L.error("AWS_ACCESS_KEY_ID missing or not set in .env"); process.exit(1);
  }
  if (!process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY === "your_aws_secret_key_here") {
    L.error("AWS_SECRET_ACCESS_KEY missing or not set in .env"); process.exit(1);
  }

  const lecture    = TEST_LECTURE;
  const lectureId  = lecture._id.$oid;
  const tpStreamId = lecture.tpStreamId;

  L.banner("TEST PIPELINE — Hinglish → English — Single Lecture");
  L.kv("Lecture:", lecture.lectureName);
  L.kv("ID:", lectureId);
  L.kv("tpStream:", tpStreamId);
  L.kv("Local VTT:", LOCAL_VTT);
  L.kv("Voice:", `${_voiceGender} (${process.env.SARVAM_SPEAKER})`);
  L.kv("S3 dest:", `s3://${S3_BUCKET}/${S3_PREFIX}/${lectureId}/`);
  L.divider();

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Step 1 — Read local VTT
  L.divider();
  L.write("  Step 1/3  Reading local Hinglish VTT... ");

  if (!fs.existsSync(LOCAL_VTT)) {
    L.append("FILE NOT FOUND");
    L.error(`input.vtt not found at ${LOCAL_VTT}`);
    process.exit(1);
  }

  const vttContent = fs.readFileSync(LOCAL_VTT, "utf-8");

  if (!vttContent.includes("WEBVTT")) {
    L.append("INVALID");
    L.error("File does not contain valid WEBVTT content");
    process.exit(1);
  }

  const vttLines  = vttContent.split("\n").length;
  const vttSizeKB = (Buffer.byteLength(vttContent, "utf-8") / 1024).toFixed(1);
  L.done("OK");
  L.success(`VTT loaded — ${vttLines} lines  /  ${vttSizeKB} KB`);

  // Setup paths
  const lectureDir  = path.join(OUTPUT_DIR, lectureId);
  const tmpDir      = path.join(lectureDir, "tmp");
  fs.mkdirSync(lectureDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const inputVTT    = path.join(lectureDir, "input.vtt");
  const outputVTT   = path.join(lectureDir, "english.vtt");
  const outputAudio = path.join(lectureDir, "english.wav");

  fs.writeFileSync(inputVTT, vttContent, "utf-8");
  L.success(`Saved locally → ${inputVTT}`);

  // Step 2 — Convert
  L.divider();
  L.step("  Step 2/3  Running English conversion pipeline...");
  L.detail("(Phase 1 = TTS+rewrite, Phase 2 = combine)");

  const convertStart  = Date.now();
  const pipelineResult = await processPipeline(inputVTT, outputVTT, outputAudio, tmpDir);
  const convertMs      = Date.now() - convertStart;

  L.success(`Conversion complete in ${fmtDuration(convertMs)}`);
  L.detail(`Accuracy:       ${pipelineResult.accuracy}%`);
  L.detail(`Audio duration: ${pipelineResult.totalDuration.toFixed(2)}s  (expected ${pipelineResult.expectedTotal.toFixed(2)}s)`);

  // Step 3 — Upload
  L.divider();
  L.step("  Step 3/3  Uploading to S3...");

  const uploadStart = Date.now();
  const audioKey    = `${S3_PREFIX}/${lectureId}/audio.wav`;
  const vttKey      = `${S3_PREFIX}/${lectureId}/audio.vtt`;

  const audioSizeMB = (fs.statSync(outputAudio).size / 1024 / 1024).toFixed(1);
  const vttSizeKB2  = (fs.statSync(outputVTT).size / 1024).toFixed(1);

  L.write(`    Uploading audio.wav  [${audioSizeMB} MB]... `);
  await uploadToS3(outputAudio, audioKey);
  L.done(`(${fmtMs(Date.now() - uploadStart)})`);

  const vttUpStart = Date.now();
  L.write(`    Uploading audio.vtt  [${vttSizeKB2} KB]...  `);
  await uploadToS3(outputVTT, vttKey);
  L.done(`(${fmtMs(Date.now() - vttUpStart)})`);

  const uploadMs = Date.now() - uploadStart;
  L.success(`Upload complete in ${fmtDuration(uploadMs)}`);

  // Cleanup tmp
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    L.success(`Deleted tmp folder → ${tmpDir}`);
  }

  // Final summary
  const totalMs = Date.now() - runStart;

  L.banner("TEST COMPLETE");
  L.kv("Lecture:", lecture.lectureName);
  L.thinDivider();
  L.kv("Local english.wav:", outputAudio);
  L.kv("Local english.vtt:", outputVTT);
  L.kv("S3 audio:", `s3://${S3_BUCKET}/${audioKey}`);
  L.kv("S3 vtt:", `s3://${S3_BUCKET}/${vttKey}`);
  L.thinDivider();
  L.kv("Accuracy:", `${pipelineResult.accuracy}%`);
  L.kv("Audio duration:", `${pipelineResult.totalDuration.toFixed(2)}s  /  expected ${pipelineResult.expectedTotal.toFixed(2)}s`);
  L.thinDivider();
  L.kv("Step 1 VTT:", "local file");
  L.kv("Step 2 Convert:", fmtDuration(convertMs));
  L.kv("Step 3 Upload:", fmtDuration(uploadMs));
  L.kv("► TOTAL TIME:", fmtDuration(totalMs));
  L.divider();
  console.log();
}

main().catch((err) => {
  L.error(`Fatal: ${err.message}`);
  process.exit(1);
});
