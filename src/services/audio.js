const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { SAMPLE_RATE, MAX_ATEMPO_RATIO, MIN_ATEMPO_RATIO, MIN_SILENCE_KEEP } = require("../config");

function getAudioDuration(filePath) {
  const r = execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", filePath,
  ]).toString().trim();
  return parseFloat(r);
}

function generateSilence(outputFile, duration) {
  if (duration <= 0) return;
  execFileSync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", `anullsrc=r=${SAMPLE_RATE}:cl=mono`,
    "-t", duration.toFixed(4), "-c:a", "pcm_s16le", outputFile,
  ], { stdio: "pipe" });
}

function detectSilences(filePath, noiseDb = -30, minDuration = 0.04) {
  let stderr = "";
  try {
    execFileSync("ffmpeg", [
      "-i", filePath, "-af", `silencedetect=noise=${noiseDb}dB:d=${minDuration}`,
      "-f", "null", "-",
    ], { stdio: ["pipe", "pipe", "pipe"] });
  } catch (e) {
    stderr = e.stderr ? e.stderr.toString() : "";
  }
  const silences = [];
  let curStart = null;
  for (const line of stderr.split("\n")) {
    const sm = line.match(/silence_start:\s*([\d.]+)/);
    const em = line.match(/silence_end:\s*([\d.]+)/);
    if (sm) curStart = parseFloat(sm[1]);
    if (em && curStart !== null) {
      const se = parseFloat(em[1]);
      silences.push({ start: curStart, end: se, duration: se - curStart });
      curStart = null;
    }
  }
  return silences;
}

function isSilentAudio(filePath, { thresholdDb = -60, chunkMs = 100 } = {}) {
  const buf = fs.readFileSync(filePath);

  if (buf.toString('ascii', 0, 4) !== 'RIFF' ||
      buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a valid WAV file');
  }

  let offset = 12;
  let sampleRate, bitsPerSample, numChannels, dataOffset, dataSize;
  while (offset < buf.length - 8) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      numChannels   = buf.readUInt16LE(offset + 10);
      sampleRate    = buf.readUInt32LE(offset + 12);
      bitsPerSample = buf.readUInt16LE(offset + 22);
    } else if (id === 'data') {
      dataOffset = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size;
  }

  if (bitsPerSample !== 16) {
    throw new Error(`Only 16-bit PCM supported (got ${bitsPerSample}-bit)`);
  }

  const bytesPerSample = 2;
  const totalSamples = Math.floor(dataSize / bytesPerSample / numChannels);
  const samplesPerChunk = Math.max(1, Math.floor(sampleRate * chunkMs / 1000));

  let chunkSumSq = 0;
  let chunkCount = 0;
  let loudestChunkRms = 0;

  for (let i = 0; i < totalSamples; i++) {
    let s = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      s += buf.readInt16LE(dataOffset + (i * numChannels + ch) * bytesPerSample);
    }
    s = s / numChannels / 32768;

    chunkSumSq += s * s;
    chunkCount++;

    if (chunkCount >= samplesPerChunk) {
      const rms = Math.sqrt(chunkSumSq / chunkCount);
      if (rms > loudestChunkRms) loudestChunkRms = rms;
      chunkSumSq = 0;
      chunkCount = 0;
    }
  }
  if (chunkCount > 0) {
    const rms = Math.sqrt(chunkSumSq / chunkCount);
    if (rms > loudestChunkRms) loudestChunkRms = rms;
  }

  const toDb = v => (v === 0 ? -Infinity : 20 * Math.log10(v));
  const loudestChunkDb = toDb(loudestChunkRms);

  return loudestChunkDb < thresholdDb;
}

function applyAtempo(inputFile, ratio, tmpDir, tag) {
  const filters = [];
  let rem = ratio;
  while (rem > 2.0) { filters.push("atempo=2.0"); rem /= 2.0; }
  while (rem < 0.5) { filters.push("atempo=0.5"); rem *= 2.0; }
  filters.push(`atempo=${rem.toFixed(6)}`);

  const out = path.join(tmpDir, `atempo_${tag}.wav`);
  execFileSync("ffmpeg", [
    "-y", "-i", inputFile,
    "-af", filters.join(","),
    "-ar", String(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", out,
  ], { stdio: "pipe" });
  return out;
}

function smartCompress(inputFile, targetDuration, tmpDir, tag) {
  const actualDuration = getAudioDuration(inputFile);
  const ratio = actualDuration / targetDuration;

  if (ratio <= MAX_ATEMPO_RATIO) {
    return applyAtempo(inputFile, ratio, tmpDir, tag);
  }

  const silences = detectSilences(inputFile);
  const inner = silences.filter((s) => s.start > 0.02 && s.end < actualDuration - 0.02);

  let trimmedFile = inputFile;
  if (inner.length > 0) {
    const bounds = [];
    let cursor = 0;
    for (const s of inner) {
      const trimAmount = Math.max(0, s.duration - MIN_SILENCE_KEEP);
      if (trimAmount <= 0) continue;
      const keepEnd = s.start + MIN_SILENCE_KEEP / 2;
      if (keepEnd > cursor) bounds.push({ start: cursor, end: keepEnd });
      cursor = s.end - MIN_SILENCE_KEEP / 2;
    }
    if (cursor < actualDuration) bounds.push({ start: cursor, end: actualDuration });

    if (bounds.length > 0) {
      const segFiles = [];
      for (let i = 0; i < bounds.length; i++) {
        const b = bounds[i];
        const dur = b.end - b.start;
        if (dur <= 0) continue;
        const sf = path.join(tmpDir, `sctrim_${tag}_${i}.wav`);
        execFileSync("ffmpeg", [
          "-y", "-i", inputFile,
          "-ss", b.start.toFixed(4), "-t", dur.toFixed(4),
          "-ar", String(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", sf,
        ], { stdio: "pipe" });
        segFiles.push(sf);
      }

      if (segFiles.length > 0) {
        const listFile = path.join(tmpDir, `sctrimlist_${tag}.txt`);
        fs.writeFileSync(listFile, segFiles.map((f) => `file '${f}'`).join("\n"), "utf-8");
        trimmedFile = path.join(tmpDir, `sctrimmed_${tag}.wav`);
        execFileSync("ffmpeg", [
          "-y", "-f", "concat", "-safe", "0", "-i", listFile,
          "-c:a", "pcm_s16le", trimmedFile,
        ], { stdio: "pipe" });
      }
    }
  }

  const trimmedDur = getAudioDuration(trimmedFile);
  const newRatio = trimmedDur / targetDuration;
  if (newRatio > 1.02) {
    const cappedRatio = Math.min(newRatio, MAX_ATEMPO_RATIO);
    return applyAtempo(trimmedFile, cappedRatio, tmpDir, tag);
  }
  return trimmedFile;
}

function padEnd(inputFile, targetDuration, tmpDir, tag) {
  const dur = getAudioDuration(inputFile);
  const pad = targetDuration - dur;
  if (pad <= 0) return inputFile;

  const normIn = path.join(tmpDir, `padnorm_${tag}.wav`);
  execFileSync("ffmpeg", [
    "-y", "-i", inputFile,
    "-ar", String(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", normIn,
  ], { stdio: "pipe" });

  const silFile = path.join(tmpDir, `padtrail_${tag}.wav`);
  generateSilence(silFile, pad);

  const listFile = path.join(tmpDir, `padlist_${tag}.txt`);
  fs.writeFileSync(listFile, `file '${normIn}'\nfile '${silFile}'`, "utf-8");

  const out = path.join(tmpDir, `padded_${tag}.wav`);
  execFileSync("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", listFile,
    "-c:a", "pcm_s16le", out,
  ], { stdio: "pipe" });
  return out;
}

function splitPad(inputFile, targetDuration, tmpDir, tag) {
  const actualDuration = getAudioDuration(inputFile);
  const extraTime = targetDuration - actualDuration;
  if (extraTime <= 0) return inputFile;

  const silences = detectSilences(inputFile);
  const inner = silences.filter((s) => s.start > 0.02 && s.end < actualDuration - 0.02);
  if (inner.length === 0) return padEnd(inputFile, targetDuration, tmpDir, tag);

  const extraPerGap = extraTime / inner.length;
  const splitPts = inner.map((s) => (s.start + s.end) / 2);
  const bounds = [0, ...splitPts, actualDuration];

  const segs = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const ss = bounds[i];
    const sd = bounds[i + 1] - ss;
    if (sd <= 0) continue;
    const sf = path.join(tmpDir, `sp_${tag}_${i}.wav`);
    execFileSync("ffmpeg", [
      "-y", "-i", inputFile,
      "-ss", ss.toFixed(4), "-t", sd.toFixed(4),
      "-ar", String(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", sf,
    ], { stdio: "pipe" });
    segs.push(sf);
  }

  const entries = [];
  for (let i = 0; i < segs.length; i++) {
    entries.push(`file '${segs[i]}'`);
    if (i < segs.length - 1) {
      const gap = path.join(tmpDir, `spgap_${tag}_${i}.wav`);
      generateSilence(gap, extraPerGap);
      entries.push(`file '${gap}'`);
    }
  }

  const listFile = path.join(tmpDir, `splist_${tag}.txt`);
  fs.writeFileSync(listFile, entries.join("\n"), "utf-8");

  const out = path.join(tmpDir, `split_${tag}.wav`);
  execFileSync("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", listFile,
    "-c:a", "pcm_s16le", out,
  ], { stdio: "pipe" });
  return out;
}

function forceExactDuration(inputFile, targetDuration, tmpDir, tag) {
  const dur = getAudioDuration(inputFile);
  if (Math.abs(dur - targetDuration) < 0.03) return inputFile;
  const out = path.join(tmpDir, `exact_${tag}.wav`);
  if (dur > targetDuration) {
    execFileSync("ffmpeg", [
      "-y", "-i", inputFile,
      "-t", targetDuration.toFixed(4),
      "-ar", String(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", out,
    ], { stdio: "pipe" });
  } else {
    return padEnd(inputFile, targetDuration, tmpDir, `exact_${tag}`);
  }
  return out;
}

function fitAudioToSlot(rawFile, targetDuration, tmpDir, tag) {
  const rawDur = getAudioDuration(rawFile);
  const diff = rawDur - targetDuration;
  const ratio = rawDur / targetDuration;

  let resultFile;

  if (Math.abs(diff) < 0.05) {
    resultFile = rawFile;
  } else if (diff > 0) {
    resultFile = smartCompress(rawFile, targetDuration, tmpDir, tag);
  } else {
    const atempoToApply = Math.max(MIN_ATEMPO_RATIO, ratio);

    if (atempoToApply < 1.0) {
      const slowedFile = applyAtempo(rawFile, atempoToApply, tmpDir, `${tag}_slow`);
      const slowedDur = getAudioDuration(slowedFile);
      process.stdout.write(`\x1b[35m[slow×${atempoToApply.toFixed(2)} ${rawDur.toFixed(2)}s→${slowedDur.toFixed(2)}s]\x1b[0m `);

      if (slowedDur >= targetDuration - 0.05) {
        resultFile = slowedFile;
      } else {
        resultFile = padEnd(slowedFile, targetDuration, tmpDir, `${tag}_slowpad`);
      }
    } else {
      resultFile = padEnd(rawFile, targetDuration, tmpDir, tag);
    }
  }

  resultFile = forceExactDuration(resultFile, targetDuration, tmpDir, tag);
  return resultFile;
}

module.exports = {
  getAudioDuration,
  generateSilence,
  detectSilences,
  isSilentAudio,
  applyAtempo,
  smartCompress,
  padEnd,
  splitPad,
  forceExactDuration,
  fitAudioToSlot,
};
