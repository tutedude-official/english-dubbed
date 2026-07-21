const path = require("path");
const { MAX_REWRITE_ATTEMPTS, REWRITE_DELAY_MS, TOLERANCE_OVER, TOLERANCE_UNDER } = require("../config");
const { callJsonModel } = require("../services/openai");
const { callTTS } = require("../services/tts");
const { generateSilence, getAudioDuration, fitAudioToSlot } = require("../services/audio");
const { normalizeOutput } = require("./text");
const { countSpeakableChars, getCharsPerSecondForSlot } = require("./merge");
const { fmtDuration } = require("../utils/format");
const L = require("../utils/logger");

// ── English rewrite rules injected into every GPT prompt ─────────────────────

const ENGLISH_RULES = `
You are rewriting English subtitle text to fit a specific time slot for dubbing.

RULE 1 — PRESERVE TECHNICAL TERMS:
  Keep all technical terms, tool names, software names, brand names, acronyms, and industry jargon exactly as they appear in the input (framework, model, API, React, Python, etc.)

RULE 2 — NATURAL ENGLISH:
  - Produce fluent, grammatically correct English
  - Use casual, conversational teaching tone (like a real instructor explaining to students)

RULE 3 — OUTPUT must be ONLY in English (Latin script). No Devanagari characters in output.

RULE 4 — Do NOT add information that is not in the original. Stay faithful to the meaning.`.trim();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── GPT rewrite for duration fit ──────────────────────────────────────────────

async function rewriteForDuration(englishText, hinglishText, durationSec, actualTTSDuration, attempt, context) {
  const tooLong = actualTTSDuration > durationSec;
  const diffSec = Math.abs(actualTTSDuration - durationSec);
  const currentChars = countSpeakableChars(englishText);
  const cps = getCharsPerSecondForSlot(durationSec);
  const targetChars = Math.round(durationSec * cps);

  const prevEnglish = (context && context.prevEnglish) || "";
  const nextEnglish = (context && context.nextEnglish) || "";
  const prevHinglish = (context && context.prevHinglish) || "";
  const nextHinglish = (context && context.nextHinglish) || "";

  let contextBlock = "";
  if (prevEnglish || prevHinglish) {
    contextBlock += `\n\nPREVIOUS CUE:`;
    if (prevEnglish)  contextBlock += `\n  English: "${prevEnglish}"`;
    if (prevHinglish) contextBlock += `\n  Hinglish: "${prevHinglish}"`;
  }
  if (nextEnglish || nextHinglish) {
    contextBlock += `\nNEXT CUE:`;
    if (nextEnglish)  contextBlock += `\n  English: "${nextEnglish}"`;
    if (nextHinglish) contextBlock += `\n  Hinglish: "${nextHinglish}"`;
  }

  let systemPrompt;

  if (tooLong) {
    const charsToRemove = currentChars - targetChars;
    systemPrompt = `
You rewrite one English subtitle line to make it SHORTER to fit the time slot.

${ENGLISH_RULES}

MEANING FIDELITY: Preserve the same meaning as the Hinglish original. Do not drop key facts.

NUMBERS:
- Current text: ~${currentChars} speakable characters
- Target: ~${targetChars} characters (${durationSec.toFixed(2)}s slot at ~${cps.toFixed(1)} chars/sec)
- Remove roughly ${Math.max(1, charsToRemove)} characters
- Current TTS: ${actualTTSDuration.toFixed(2)}s, Slot: ${durationSec.toFixed(2)}s (${diffSec.toFixed(2)}s too long)

HOW TO SHORTEN:
- Rephrase the same idea in fewer words
- Use shorter synonyms, drop filler phrases
- Keep core meaning and natural English style
${attempt > 3 ? "- Be VERY aggressive. Keep only the essential meaning." : attempt > 2 ? "- Be aggressive. Cut filler words and simplify." : "- Try moderate shortening first."}
${contextBlock}

Return strict JSON: {"englishText":"..."}`.trim();
  } else {
    const charsToAdd = targetChars - currentChars;
    systemPrompt = `
You rewrite one English subtitle line to make it LONGER to fill the time slot.

${ENGLISH_RULES}

MEANING FIDELITY: Expanded text must convey the SAME meaning as the Hinglish original.

NUMBERS:
- Current text: ~${currentChars} speakable characters
- Target: ~${targetChars} characters (${durationSec.toFixed(2)}s slot at ~${cps.toFixed(1)} chars/sec)
- Add roughly ${Math.max(1, charsToAdd)} characters
- Current TTS: ${actualTTSDuration.toFixed(2)}s, Slot: ${durationSec.toFixed(2)}s (${diffSec.toFixed(2)}s too short)

HOW TO EXPAND:
1. Rephrase more verbosely — say the same thing in a longer, more explanatory way
2. Add a natural bridge to the previous or next cue
3. Add teacher-style filler phrases: "what I mean is", "so basically", "you see", "now here's the thing", "pay attention to this"
4. Expand with a natural explanation of the concept
${attempt > 3 ? "- Be VERY generous. Rephrase the whole sentence to be much more verbose." : attempt > 2 ? "- Be generous. Add substantial new phrasing." : "- Add moderate expansion."}
${contextBlock}

Return strict JSON: {"englishText":"..."}`.trim();
  }

  const payload = {
    task: tooLong ? "shorten" : "expand",
    currentEnglish: englishText,
    originalHinglish: hinglishText,
    currentCharCount: currentChars,
    targetCharCount: targetChars,
    slotDurationSec: Number(durationSec.toFixed(2)),
    currentTTSDurationSec: Number(actualTTSDuration.toFixed(2)),
  };

  const data = await callJsonModel(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(payload, null, 2) },
    ],
    1000
  );

  return normalizeOutput(data.englishText || englishText);
}

// ── Phase 1 orchestrator ──────────────────────────────────────────────────────

async function phase1_ttsAndRewriteLoop(cueData, tmpDir) {
  const phaseStart = Date.now();
  L.banner("PHASE 1: TTS → Duration Check → Rewrite Loop");

  const results = [];
  let totalTTSCalls = 0;
  let totalRewriteCalls = 0;

  for (let i = 0; i < cueData.length; i++) {
    const cueStart = Date.now();
    const cue = cueData[i];
    const target = cue.durationSec;
    let currentEnglish = cue.englishText;
    let attempt = 0;
    let ttsDuration = 0;
    let rawFile = null;
    let bestFile = null;
    let bestEnglish = currentEnglish;
    let bestDiff = Infinity;
    let status = "PENDING";

    const elapsedMs = Date.now() - phaseStart;
    const avgMsPerCue = i > 0 ? elapsedMs / i : 0;
    const etaStr = i > 0
      ? `ETA ~${fmtDuration(avgMsPerCue * (cueData.length - i))}`
      : "ETA calculating...";

    process.stdout.write(`\n`);
    L.step(`  Cue ${i + 1}/${cueData.length}  target=${target.toFixed(2)}s  ${etaStr}`);
    process.stdout.write(`  `);

    while (attempt <= MAX_REWRITE_ATTEMPTS) {
      const tag = `cue${i + 1}_v${attempt}`;
      rawFile = path.join(tmpDir, `${tag}_raw.wav`);

      try {
        if (!currentEnglish.trim()) {
          generateSilence(rawFile, target);
          ttsDuration = target;
        } else {
          const ttsStart = Date.now();
          await callTTS(currentEnglish, rawFile);
          ttsDuration = getAudioDuration(rawFile);
          totalTTSCalls++;
          process.stdout.write(`TTS=${ttsDuration.toFixed(2)}s (${fmtDuration(Date.now() - ttsStart)}) `);
        }
      } catch (err) {
        process.stdout.write("\n");
        L.error(`TTS failed: ${err.message}`);
        generateSilence(rawFile, target);
        ttsDuration = target;
        break;
      }

      const diff = Math.abs(ttsDuration - target);
      const ratio = ttsDuration / target;
      const isOver  = ttsDuration > target * (1 + TOLERANCE_OVER);
      const isUnder = target >= 2.4 && ttsDuration < target * (1 - TOLERANCE_UNDER);

      if (diff < bestDiff) {
        bestDiff = diff;
        bestFile = rawFile;
        bestEnglish = currentEnglish;
      }

      if (!isOver && !isUnder) {
        status = "OK";
        process.stdout.write(`\x1b[32m✓ fit\x1b[0m `);
        break;
      }

      if (attempt >= MAX_REWRITE_ATTEMPTS) {
        status = "AUDIO_FIT";
        process.stdout.write(`\x1b[33m⚠ audio-fit\x1b[0m `);
        break;
      }

      attempt++;
      totalRewriteCalls++;
      const dir = isOver ? "SHORTEN" : "EXPAND";
      process.stdout.write(`\n    \x1b[36m→ v${attempt} ${dir} (ratio=${ratio.toFixed(2)})\x1b[0m `);

      const rewriteContext = {
        prevEnglish:  i > 0 ? (cueData[i - 1].englishText || "") : "",
        nextEnglish:  i < cueData.length - 1 ? (cueData[i + 1].englishText || "") : "",
        prevHinglish: i > 0 ? (cueData[i - 1].hinglishText || "") : "",
        nextHinglish: i < cueData.length - 1 ? (cueData[i + 1].hinglishText || "") : "",
      };

      try {
        currentEnglish = await rewriteForDuration(currentEnglish, cue.hinglishText, target, ttsDuration, attempt, rewriteContext);
        await sleep(REWRITE_DELAY_MS);
      } catch (err) {
        process.stdout.write(`\x1b[31mrewrite failed\x1b[0m `);
        break;
      }
    }

    const finalRawFile = bestFile || rawFile;
    const finalEnglish = bestEnglish;

    const tag = `cue${i + 1}_final`;
    const fittedFile = fitAudioToSlot(finalRawFile, target, tmpDir, tag);
    const finalDur = getAudioDuration(fittedFile);
    const cueDriftMs = Math.round(Math.abs(finalDur - target) * 1000);

    process.stdout.write(`\x1b[2m→ fitted=${finalDur.toFixed(2)}s  drift=${cueDriftMs}ms  [${fmtDuration(Date.now() - cueStart)}]\x1b[0m`);

    cue.englishText = finalEnglish;

    results.push({
      idx: i,
      start: cue.start,
      end: cue.end,
      target,
      finalFile: fittedFile,
      finalDuration: finalDur,
      englishText: finalEnglish,
      status,
      rewrites: attempt,
    });

    if (i < cueData.length - 1) await sleep(250);
  }

  const phaseMs = Date.now() - phaseStart;
  console.log();
  L.success(`Phase 1 complete — ${cueData.length} cues in ${fmtDuration(phaseMs)}`);
  L.detail(`TTS calls: ${totalTTSCalls}  |  GPT rewrites: ${totalRewriteCalls}`);
  console.log();
  return { results, phaseMs };
}

module.exports = { phase1_ttsAndRewriteLoop, rewriteForDuration, ENGLISH_RULES };
