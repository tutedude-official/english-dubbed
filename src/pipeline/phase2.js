const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { SAMPLE_RATE } = require("../config");
const { generateSilence } = require("../services/audio");
const { fmtDuration } = require("../utils/format");
const L = require("../utils/logger");

function phase2_combine(results, tmpDir, finalOutput) {
  const phaseStart = Date.now();
  L.banner("PHASE 2: Combining all segments into final audio");
  L.detail(`Segments to merge: ${results.length}`);

  const concatParts = [];
  let pi = 0;

  for (let i = 0; i < results.length; i++) {
    const seg = results[i];
    const prevEnd = i === 0 ? 0 : results[i - 1].end;
    const gap = seg.start - prevEnd;

    if (gap > 0.005) {
      const sf = path.join(tmpDir, `finalgap_${pi}.wav`);
      generateSilence(sf, gap);
      concatParts.push(sf);
      pi++;
    }

    concatParts.push(seg.finalFile);
    pi++;
  }

  L.write(`  Normalizing ${concatParts.length} parts... `);
  const normParts = [];
  for (let i = 0; i < concatParts.length; i++) {
    const nf = path.join(tmpDir, `fnorm_${i}.wav`);
    execFileSync("ffmpeg", [
      "-y", "-i", concatParts[i],
      "-ar", String(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", nf,
    ], { stdio: "pipe" });
    normParts.push(nf);
  }
  L.done();

  const concatList = path.join(tmpDir, "final_list.txt");
  fs.writeFileSync(concatList, normParts.map((f) => `file '${f}'`).join("\n"), "utf-8");

  L.write(`  Concatenating into final WAV... `);
  execFileSync("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", concatList,
    "-c:a", "pcm_s16le", finalOutput,
  ], { stdio: "pipe" });

  const phaseMs = Date.now() - phaseStart;
  const fileSizeMB = (fs.statSync(finalOutput).size / 1024 / 1024).toFixed(1);
  L.done(`(${fmtDuration(phaseMs)})`);
  L.success(`Output: ${finalOutput}  [${fileSizeMB} MB]`);
  console.log();
  return phaseMs;
}

module.exports = { phase2_combine };
