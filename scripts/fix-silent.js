// Orchestrator: for each course JSON in data/, spawn fix-silent-worker with the
// proper SARVAM_VOICE env so the pipeline picks up the right speaker.
//
// Voice mapping (per user):
//   aivideogen        → male
//   instagramcreator  → female
//   digitalmarketing  → male

const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const VOICE_BY_SLUG = {
  aivideogen: "male",
  instagramcreator: "female",
  digitalmarketing: "male",
};

const DATA_DIR = path.join(__dirname, "../data");
const WORKER = path.join(__dirname, "fix-silent-worker.js");

// Optional CLI filter: node scripts/fix-silent.js aivideogen instagramcreator
const filter = process.argv.slice(2);

const allFiles = fs.readdirSync(DATA_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ file: f, slug: path.basename(f, ".json") }))
  .filter((e) => filter.length === 0 || filter.includes(e.slug));

if (allFiles.length === 0) {
  console.error("No course JSONs matched. Available slugs:",
    fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json")).map((f) => path.basename(f, ".json")));
  process.exit(1);
}

console.log(`\n=== fix-silent orchestrator — ${allFiles.length} course(s) ===\n`);

let failed = 0;
for (const { file, slug } of allFiles) {
  const voice = VOICE_BY_SLUG[slug];
  if (!voice) {
    console.warn(`\n[skip] ${slug}: no voice mapping defined (add to VOICE_BY_SLUG)\n`);
    continue;
  }
  const coursePath = path.join(DATA_DIR, file);
  console.log(`\n>>> ${slug}  voice=${voice}\n`);
  const res = spawnSync("node", [WORKER, coursePath], {
    stdio: "inherit",
    env: { ...process.env, SARVAM_VOICE: voice },
  });
  if (res.status !== 0) {
    failed++;
    console.error(`\n[!] worker failed for ${slug} (exit ${res.status})\n`);
  }
}

console.log(`\n=== orchestrator done — ${allFiles.length - failed}/${allFiles.length} courses succeeded ===\n`);
process.exit(failed === 0 ? 0 : 1);
