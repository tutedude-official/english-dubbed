function parseVTT(content) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const cues = [];
  let i = 0;
  while (i < lines.length && !lines[i].startsWith("WEBVTT")) i++;
  i++;
  while (i < lines.length) {
    if (!lines[i] || lines[i].trim() === "") { i++; continue; }
    if (lines[i].trim().startsWith("NOTE")) {
      while (i < lines.length && lines[i].trim() !== "") i++;
      continue;
    }
    const cue = { id: null, timestamp: null, text: [] };
    if (lines[i] && !lines[i].includes("-->")) { cue.id = lines[i].trim(); i++; }
    if (lines[i] && lines[i].includes("-->")) { cue.timestamp = lines[i].trim(); i++; }
    else { i++; continue; }
    while (i < lines.length && lines[i].trim() !== "") { cue.text.push(lines[i].trim()); i++; }
    if (cue.timestamp) cues.push(cue);
  }
  return cues;
}

function timeToSeconds(timeStr) {
  const parts = timeStr.trim().replace(",", ".").split(":");
  if (parts.length === 3) return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
  return Number(timeStr);
}

function parseTimestamp(ts) {
  const [s, e] = ts.split("-->").map((x) => x.trim());
  return { start: timeToSeconds(s), end: timeToSeconds(e) };
}

function secondsToVttTime(totalSeconds) {
  const safe = Math.max(0, totalSeconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

function buildTimestamp(start, end) {
  return `${secondsToVttTime(start)} --> ${secondsToVttTime(end)}`;
}

function serializeVTT(cues) {
  let out = "WEBVTT\n\n";
  for (const c of cues) {
    out += `${c.timestamp}\n`;
    if (c.englishText && c.englishText.trim()) {
      out += `${c.englishText}\n\n`;
    } else {
      out += `\n`;
    }
  }
  return out.trimEnd() + "\n";
}

module.exports = { parseVTT, parseTimestamp, buildTimestamp, serializeVTT, secondsToVttTime };
