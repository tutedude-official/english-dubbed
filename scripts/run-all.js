require("dotenv").config();

// Parse --voice=male|female (default: male → shubh, female → roopa)
const _voiceArg = process.argv.find(a => a.startsWith("--voice="));
const _voiceGender = _voiceArg ? _voiceArg.split("=")[1].toLowerCase() : "male";
process.env.SARVAM_SPEAKER = _voiceGender === "female" ? "roopa" : "shubh";

const path = require("path");
const { main } = require("./run-pipeline");
const L = require("../src/utils/logger");
const { fmtDuration } = require("../src/utils/format");

const COURSES = [
  path.join(__dirname, "../data/dataanalytics.json")
];

// Lecture limit configuration
// Set to a number to limit lectures per course, or "all" / null / undefined for no limit
// Can also be set via CLI: node run-all.js --limit=10 or node run-all.js --limit=all
// 32 lectures ≈ 10 hours of content (avg 25.9 min/lecture)
const DEFAULT_LECTURE_LIMIT = 32;

function parseLectureLimit() {
  const args = process.argv.slice(2);
  const limitArg = args.find(arg => arg.startsWith("--limit="));
  
  if (limitArg) {
    const value = limitArg.split("=")[1];
    if (value === "all" || value === "") {
      return null;
    }
    const num = parseInt(value, 10);
    if (!isNaN(num) && num > 0) {
      return num;
    }
    L.warn(`Invalid limit value "${value}", using default`);
  }
  
  if (DEFAULT_LECTURE_LIMIT === "all" || DEFAULT_LECTURE_LIMIT == null) {
    return null;
  }
  return DEFAULT_LECTURE_LIMIT;
}

async function runAll() {
  if (!process.env.OPENAI_API_KEY) { L.error("OPENAI_API_KEY missing in .env"); process.exit(1); }

  const lectureLimit = parseLectureLimit();
  const startTime = Date.now();
  const courseNames = COURSES.map((c) => path.basename(c, ".json"));

  L.banner("ENGLISH DUB PIPELINE — ALL COURSES");
  L.kv("Courses:", courseNames.join(", "));
  L.kv("Total:", String(COURSES.length));
  L.kv("Voice:", `${_voiceGender} (${process.env.SARVAM_SPEAKER})`);
  L.kv("Lecture Limit:", lectureLimit ? String(lectureLimit) : "ALL (no limit)");
  L.divider();
  console.log();

  const results = await Promise.allSettled(
    COURSES.map((courseJson) => main(courseJson, { lectureLimit }))
  );

  console.log();
  L.banner("ALL COURSES — FINAL SUMMARY");

  results.forEach((result, i) => {
    const name = courseNames[i];
    if (result.status === "fulfilled") {
      L.success(`[${name}] Completed successfully`);
    } else {
      L.error(`[${name}] Failed: ${result.reason?.message || result.reason}`);
    }
  });

  const totalMs = Date.now() - startTime;
  L.thinDivider();
  L.kv("Total wall time:", fmtDuration(totalMs));
  L.divider();
  console.log();

  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    process.exit(1);
  }
}

runAll().catch((err) => {
  L.error(`Fatal: ${err.message}`);
  process.exit(1);
});
