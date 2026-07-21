#!/usr/bin/env node

/**
 * Create a preview video with dubbed English audio.
 *
 * Downloads video from TPStream (first N seconds) and replaces
 * the audio with the generated english.wav.
 *
 * Usage:
 *   node utils-scripts/preview-dub.js <tpStreamId> [--duration=60] [--audio=path] [--output=path]
 *
 * Examples:
 *   node utils-scripts/preview-dub.js 7NPTbp7SU5J
 *   node utils-scripts/preview-dub.js 7NPTbp7SU5J --duration=60 --audio=output/7NPTbp7SU5J/english.wav
 */

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const CLOUDFRONT_BASE = "https://d44tj0kek3n57.cloudfront.net/transcoded";
const OUTPUT_DIR = path.join(__dirname, "../output");

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {};
  let positional = null;

  for (const arg of args) {
    if (arg.startsWith("--")) {
      const [key, ...rest] = arg.slice(2).split("=");
      flags[key] = rest.join("=") || true;
    } else if (!positional) {
      positional = arg;
    }
  }

  return { positional, flags };
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    console.log(`Running: ffmpeg ${args.join(" ")}\n`);
    const proc = spawn("ffmpeg", args, { stdio: "inherit" });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    proc.on("error", (err) => reject(new Error(`Failed to start ffmpeg: ${err.message}`)));
  });
}

async function main() {
  const { positional: tpStreamId, flags } = parseArgs();

  if (!tpStreamId) {
    console.error("Usage: node utils-scripts/preview-dub.js <tpStreamId> [--duration=60] [--audio=path]");
    process.exit(1);
  }

  const duration = flags.duration || "60";
  const startSec = flags.start || null;
  const quality = flags.quality || "720p";
  const videoId = flags["video-id"] || tpStreamId;
  const videoUrl = `${CLOUDFRONT_BASE}/${videoId}/${quality}_h264/video.m3u8`;

  const audioPath = flags.audio
    ? path.resolve(flags.audio)
    : path.join(OUTPUT_DIR, tpStreamId, "english.wav");

  if (!fs.existsSync(audioPath)) {
    console.error(`English audio not found: ${audioPath}`);
    console.error(`Run the pipeline first, or pass --audio=<path>`);
    process.exit(1);
  }

  const outputPath = flags.output
    ? path.resolve(flags.output)
    : path.join(OUTPUT_DIR, tpStreamId, `preview_${duration}s.mp4`);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  console.log(`TPStream ID : ${tpStreamId}`);
  console.log(`Quality     : ${quality}`);
  console.log(`Video URL   : ${videoUrl}`);
  console.log(`English WAV : ${audioPath}`);
  console.log(`Duration    : ${duration}s`);
  console.log(`Output      : ${outputPath}\n`);

  const ffmpegArgs = [];
  if (startSec) ffmpegArgs.push("-ss", startSec);
  ffmpegArgs.push(
    "-i", videoUrl,
    "-i", audioPath,
    "-t", duration,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-y",
    outputPath,
  );

  await runFfmpeg(ffmpegArgs);

  const stats = fs.statSync(outputPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

  console.log(`\nPreview created!`);
  console.log(`  File: ${outputPath}`);
  console.log(`  Size: ${sizeMB} MB`);
  console.log(`\nOpen it with: open "${outputPath}"`);
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
